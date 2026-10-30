<?php

namespace Tests\Unit\Services;

use App\Services\TrafficAudit\TrafficAuditService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TrafficAuditServiceTest extends TestCase
{
    private object $migration;

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
}
