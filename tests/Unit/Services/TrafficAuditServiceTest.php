<?php

namespace Tests\Unit\Services;

use App\Services\TrafficAudit\TrafficAuditService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TrafficAuditServiceTest extends TestCase
{
    private object $migration;
    private bool $createdServerTable = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->migration = require database_path('migrations/2026_10_31_000001_create_traffic_audit_events_table.php');
        if (Schema::hasTable('v2_traffic_audit_events')) {
            Schema::drop('v2_traffic_audit_events');
        }
        $this->migration->up();
    }

    protected function tearDown(): void
    {
        $this->migration->down();
        if ($this->createdServerTable) {
            Schema::dropIfExists('v2_server');
        }
        parent::tearDown();
    }

    public function test_inserts_idempotent_events_with_route_dimensions(): void
    {
        $event = [
            'event_id' => 'event-1',
            'connection_id' => 'connection-1',
            'event_type' => 'start',
            'node_id' => '22',
            'occurred_at' => now()->toIso8601String(),
            'action' => 'block',
            'route_id' => 38,
            'route_tag' => 'panel-route-38',
            'route_source' => 'kernel',
            'outbound' => 'block',
            'destination' => 'example.com:443',
            'network' => 'tcp',
            'upload_bytes' => 10,
            'download_bytes' => 20,
        ];

        $first = TrafficAuditService::insertEvent($event, '127.0.0.1');
        $second = TrafficAuditService::insertEvent($event, '127.0.0.1');

        $this->assertFalse($first['duplicate']);
        $this->assertTrue($second['duplicate']);
        $this->assertDatabaseHas('v2_traffic_audit_events', [
            'event_id' => 'event-1',
            'route_id' => 38,
            'action' => 'block',
            'outbound' => 'block',
        ]);
    }

    public function test_overview_groups_user_route_and_destination(): void
    {
        TrafficAuditService::insertEvent([
            'event_id' => 'event-user',
            'user_id' => 7,
            'node_id' => '22',
            'occurred_at' => now()->toIso8601String(),
            'action' => 'route',
            'route_id' => 39,
            'destination' => 'tracker.example:443',
            'upload_bytes' => 100,
            'download_bytes' => 200,
        ]);

        $overview = app(TrafficAuditService::class)->overview(['range' => '24h']);

        $this->assertSame(1, $overview['cards']['connections']);
        $this->assertSame(300, $overview['cards']['total_bytes']);
        $this->assertSame(7, (int) $overview['users'][0]->user_id);
        $this->assertSame(39, (int) $overview['routes'][0]->route_id);
    }

    public function test_platform_traffic_uses_xray_stats_tables(): void
    {
        if (!Schema::hasTable('v2_stat_user') || !Schema::hasTable('v2_stat_server')) {
            $this->markTestSkipped('Xboard statistics tables are unavailable');
        }

        $recordAt = now()->timestamp;
        DB::table('v2_stat_user')->insert([
            'user_id' => 7,
            'u' => 1200,
            'd' => 3400,
            'record_at' => $recordAt,
            'created_at' => $recordAt,
            'updated_at' => $recordAt,
        ]);
        DB::table('v2_stat_server')->insert([
            'server_id' => 28,
            'u' => 1500,
            'd' => 3600,
            'record_at' => $recordAt,
            'created_at' => $recordAt,
            'updated_at' => $recordAt,
        ]);

        $traffic = app(TrafficAuditService::class)->platformTraffic(['range' => '24h']);

        $this->assertSame(4600, $traffic['cards']['total_bytes']);
        $this->assertSame(7, (int) $traffic['users'][0]->user_id);
        $this->assertSame(28, (int) $traffic['nodes'][0]->node_id);
    }

    public function test_analysis_groups_services_and_exact_destinations(): void
    {
        foreach ([
            ['event-ai', 'connection-ai', 'tcp:api.openai.com:443', 100, 200],
            ['event-google', 'connection-google', 'tcp:www.google.com:443', 50, 150],
            ['event-telegram', 'connection-telegram', '149.154.167.151:443', 40, 60],
            ['event-other', 'connection-other', 'tcp:unknown.example:8443', 25, 25],
        ] as [$eventId, $connectionId, $destination, $upload, $download]) {
            TrafficAuditService::insertEvent([
                'event_id' => $eventId,
                'connection_id' => $connectionId,
                'node_id' => '22',
                'occurred_at' => now()->toIso8601String(),
                'action' => 'observe',
                'destination' => $destination,
                'upload_bytes' => $upload,
                'download_bytes' => $download,
            ]);
        }

        $services = app(TrafficAuditService::class)->analysis([
            'range' => '24h',
            'dimension' => 'service',
            'sort' => 'bytes',
        ]);
        $this->assertSame(650, $services['cards']['total_bytes']);
        $this->assertSame('OpenAI', $services['rows'][0]['name']);
        $this->assertSame(300, $services['rows'][0]['total_bytes']);
        $this->assertSame('Google', $services['rows'][1]['name']);
        $this->assertSame('api.openai.com', $services['rows'][0]['destinations'][0]['name']);
        $this->assertSame('Telegram', collect($services['rows'])->firstWhere('key', 'telegram')['name']);
        $this->assertSame('其他', collect($services['rows'])->firstWhere('key', 'other')['name']);

        $destinations = app(TrafficAuditService::class)->analysis([
            'range' => '24h',
            'dimension' => 'destination',
            'sort' => 'connections',
        ]);
        $openAiDestination = collect($destinations['rows'])->firstWhere('name', 'api.openai.com');
        $this->assertNotNull($openAiDestination);
        $this->assertSame(1, $openAiDestination['connections']);
    }

    public function test_health_reports_node_coverage_and_identity_rates(): void
    {
        if (!Schema::hasTable('v2_server')) {
            Schema::create('v2_server', function (Blueprint $table): void {
                $table->id();
                $table->string('name');
                $table->string('type');
                $table->unsignedBigInteger('machine_id')->nullable();
                $table->unsignedInteger('parent_id')->nullable();
                $table->boolean('enabled')->nullable()->default(true);
                $table->integer('sort')->nullable();
            });
            $this->createdServerTable = true;
        }

        DB::table('v2_server')->insert([
            'id' => 901,
            'type' => 'vless',
            'name' => '健康测试节点',
            'enabled' => true,
            'parent_id' => 0,
        ]);
        TrafficAuditService::insertEvent([
            'event_id' => 'health-linked',
            'connection_id' => 'health-conn-1',
            'user_id' => 7,
            'node_id' => '901',
            'occurred_at' => now()->toIso8601String(),
            'action' => 'observe',
            'route_id' => 39,
            'route_tag' => 'panel-route-39',
            'upload_bytes' => 100,
            'download_bytes' => 200,
        ]);
        TrafficAuditService::insertEvent([
            'event_id' => 'health-unlinked',
            'connection_id' => 'health-conn-2',
            'node_id' => '901',
            'occurred_at' => now()->toIso8601String(),
            'action' => 'observe',
        ]);

        $health = app(TrafficAuditService::class)->health(['range' => '24h']);
        $row = collect($health['nodes'])->firstWhere('node_id', '901');

        $this->assertNotNull($row);
        $this->assertSame('healthy', $row['health_status']);
        $this->assertSame(2, $row['connections']);
        $this->assertSame(1, $row['linked_connections']);
        $this->assertSame(1, $row['unlinked_connections']);
        $this->assertSame(50.0, $row['user_link_rate']);
        $this->assertSame(50.0, $row['route_identity_rate']);
    }
}
