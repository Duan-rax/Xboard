<?php

namespace App\Services\TrafficAudit;

use App\Models\Server;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TrafficAuditService
{
    private const SERVICE_CATALOG = [
        ['key' => 'connectivity', 'name' => '连接检测', 'short' => 'C', 'color' => '#64748b', 'domains' => [
            'connectivitycheck.gstatic.com', 'connectivitycheck.android.com', 'captive.apple.com',
            'msftconnecttest.com', 'msftncsi.com', 'detectportal.firefox.com',
        ]],
        ['key' => 'openai', 'name' => 'OpenAI', 'short' => 'AI', 'color' => '#10a37f', 'domains' => [
            'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
        ]],
        ['key' => 'google', 'name' => 'Google', 'short' => 'G', 'color' => '#4285f4', 'domains' => [
            'google.com', 'googleapis.com', 'gstatic.com', 'youtube.com', 'googlevideo.com',
            'ytimg.com', 'googleusercontent.com',
        ]],
        ['key' => 'telegram', 'name' => 'Telegram', 'short' => 'T', 'color' => '#229ed9', 'domains' => [
            'telegram.org', 'telegram.me', 't.me', 'tdesktop.com', 'telesco.pe',
        ]],
        ['key' => 'microsoft', 'name' => 'Microsoft', 'short' => 'M', 'color' => '#f25022', 'domains' => [
            'microsoft.com', 'windows.com', 'live.com', 'office.com', 'sharepoint.com',
            'microsoftonline.com', 'msn.com', 'bing.com', 'windowsupdate.com',
        ]],
        ['key' => 'apple', 'name' => 'Apple', 'short' => 'A', 'color' => '#475569', 'domains' => [
            'apple.com', 'icloud.com', 'mzstatic.com',
        ]],
        ['key' => 'meta', 'name' => 'Meta', 'short' => 'M', 'color' => '#0866ff', 'domains' => [
            'facebook.com', 'instagram.com', 'whatsapp.com', 'whatsapp.net', 'fbcdn.net',
        ]],
        ['key' => 'cloudflare', 'name' => 'Cloudflare', 'short' => 'CF', 'color' => '#f48120', 'domains' => [
            'cloudflare.com', 'cloudflare-dns.com', 'workers.dev', 'cfdata.org',
        ]],
        ['key' => 'github', 'name' => 'GitHub', 'short' => 'GH', 'color' => '#24292f', 'domains' => [
            'github.com', 'githubusercontent.com', 'githubassets.com',
        ]],
        ['key' => 'netflix', 'name' => 'Netflix', 'short' => 'N', 'color' => '#e50914', 'domains' => [
            'netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxso.net',
        ]],
        ['key' => 'bytedance', 'name' => '字节跳动', 'short' => 'BD', 'color' => '#325ab4', 'domains' => [
            'tiktok.com', 'tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com',
        ]],
        ['key' => 'x', 'name' => 'X', 'short' => 'X', 'color' => '#0f172a', 'domains' => [
            'x.com', 'twitter.com', 'twimg.com',
        ]],
        ['key' => 'spotify', 'name' => 'Spotify', 'short' => 'S', 'color' => '#1db954', 'domains' => [
            'spotify.com', 'scdn.co',
        ]],
        ['key' => 'amazon', 'name' => 'Amazon', 'short' => 'AZ', 'color' => '#ff9900', 'domains' => [
            'amazon.com', 'amazonaws.com', 'cloudfront.net', 'awsstatic.com',
        ]],
        ['key' => 'discord', 'name' => 'Discord', 'short' => 'D', 'color' => '#5865f2', 'domains' => [
            'discord.com', 'discordapp.com', 'discord.gg',
        ]],
    ];

    public static function webhookSecret(): string
    {
        return (string) admin_setting(
            'traffic_audit_webhook_secret',
            config('services.traffic_audit.webhook_secret', '')
        );
    }

    public static function retentionDays(): int
    {
        return max(1, (int) admin_setting('traffic_audit_retention_days', 30));
    }

    public static function insertEvent(array $data, ?string $sourceIp = null): array
    {
        $occurredAt = !empty($data['occurred_at'])
            ? CarbonImmutable::parse($data['occurred_at'])->utc()
            : now()->utc()->toImmutable();
        $userId = isset($data['user_id']) ? (int) $data['user_id'] : null;

        if ($userId === null && is_string($data['metadata']['user'] ?? null)) {
            $reference = trim($data['metadata']['user']);
            if (preg_match('/(?:^|@)([1-9][0-9]*)$/', $reference, $matches)) {
                $userId = (int) $matches[1];
            } else {
                $userId = Cache::remember(
                    'traffic_audit_uuid_' . hash('sha256', $reference),
                    600,
                    fn () => User::query()->where('uuid', $reference)->value('id')
                );
                $userId = $userId ? (int) $userId : null;
            }
        }

        $event = [
            'event_id' => $data['event_id'],
            'connection_id' => $data['connection_id'] ?? $data['event_id'],
            'event_type' => $data['event_type'] ?? 'rule',
            'user_id' => $userId,
            'node_id' => $data['node_id'] ?? null,
            'client_source' => $data['client_source'] ?? null,
            'occurred_at' => $occurredAt,
            'action' => $data['action'],
            'route_tag' => $data['route_tag'] ?? $data['rule_tag'] ?? null,
            'route_id' => isset($data['route_id']) && (int) $data['route_id'] > 0
                ? (int) $data['route_id']
                : null,
            'route_source' => $data['route_source'] ?? null,
            'outbound' => $data['outbound'] ?? null,
            'destination' => $data['destination'] ?? null,
            'destination_ip' => $data['destination_ip'] ?? null,
            'network' => $data['network'] ?? null,
            'protocol' => $data['protocol'] ?? null,
            'source_ip' => $sourceIp,
            'upload_bytes' => max(0, (int) ($data['upload_bytes'] ?? 0)),
            'download_bytes' => max(0, (int) ($data['download_bytes'] ?? 0)),
            'metadata' => isset($data['metadata'])
                ? json_encode($data['metadata'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)
                : null,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        $inserted = DB::table('v2_traffic_audit_events')->insertOrIgnore($event) === 1;
        return ['accepted' => true, 'duplicate' => !$inserted, 'event_id' => $data['event_id']];
    }

    public function overview(array $filters = []): array
    {
        [$from, $to] = self::resolveRange($filters);
        $query = $this->filteredQuery($filters, $from, $to);
        $totals = (clone $query)->selectRaw(
            'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
            'COALESCE(SUM(download_bytes),0) download_bytes, ' .
            'COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
            'SUM(CASE WHEN action IN (\'block\',\'reject\') THEN 1 ELSE 0 END) blocked_events'
        )->first();

        return [
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'cards' => [
                'upload_bytes' => (int) ($totals->upload_bytes ?? 0),
                'download_bytes' => (int) ($totals->download_bytes ?? 0),
                'total_bytes' => (int) ($totals->upload_bytes ?? 0) + (int) ($totals->download_bytes ?? 0),
                'connections' => (int) ($totals->connections ?? 0),
                'blocked_events' => (int) ($totals->blocked_events ?? 0),
            ],
            'routes' => (clone $query)
                ->selectRaw(
                    'route_id, route_tag, action, outbound, COUNT(*) events, ' .
                    'COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                    'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                    'COALESCE(SUM(download_bytes),0) download_bytes, MAX(occurred_at) last_seen_at'
                )
                ->where(function (Builder $q): void {
                    $q->whereNotNull('route_id')->orWhereNotNull('route_tag');
                })
                ->groupBy('route_id', 'route_tag', 'action', 'outbound')
                ->orderByDesc('connections')
                ->limit(30)
                ->get(),
            'destinations' => (clone $query)
                ->whereNotNull('destination')
                ->selectRaw(
                    'destination, COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                    'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                    'COALESCE(SUM(download_bytes),0) download_bytes'
                )
                ->groupBy('destination')
                ->orderByDesc('connections')
                ->limit(20)
                ->get(),
            'nodes' => (clone $query)
                ->whereNotNull('node_id')
                ->selectRaw(
                    'node_id, COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                    'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                    'COALESCE(SUM(download_bytes),0) download_bytes'
                )
                ->groupBy('node_id')
                ->orderByDesc('connections')
                ->get(),
            'users' => (clone $query)
                ->whereNotNull('user_id')
                ->selectRaw(
                    'user_id, COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                    'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                    'COALESCE(SUM(download_bytes),0) download_bytes, ' .
                    'SUM(CASE WHEN action IN (\'block\',\'reject\') THEN 1 ELSE 0 END) blocked_events'
                )
                ->groupBy('user_id')
                ->orderByDesc('connections')
                ->limit(30)
                ->get(),
        ];
    }

    public function events(array $filters = [], int $perPage = 50)
    {
        [$from, $to] = self::resolveRange($filters);
        return $this->filteredQuery($filters, $from, $to)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->paginate(max(1, min(100, $perPage)));
    }

    public function analysis(array $filters = []): array
    {
        [$from, $to] = self::resolveRange($filters);
        $query = $this->filteredQuery($filters, $from, $to);
        $dimension = ($filters['dimension'] ?? 'service') === 'destination' ? 'destination' : 'service';
        $sort = ($filters['sort'] ?? 'bytes') === 'connections' ? 'connections' : 'bytes';
        $totals = (clone $query)->selectRaw(
            'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
            'COALESCE(SUM(download_bytes),0) download_bytes, ' .
            'COUNT(DISTINCT COALESCE(connection_id,event_id)) connections'
        )->first();

        $targetRows = (clone $query)
            ->where(function (Builder $q): void {
                $q->whereNotNull('destination')->orWhereNotNull('destination_ip');
            })
            ->selectRaw(
                'COALESCE(destination,destination_ip) destination, ' .
                'COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                'COALESCE(SUM(download_bytes),0) download_bytes'
            )
            ->groupBy(DB::raw('COALESCE(destination,destination_ip)'))
            ->get();

        $groups = [];
        foreach ($targetRows as $row) {
            $host = $this->destinationHost((string) $row->destination);
            $metadata = $dimension === 'service'
                ? $this->classifyService($host)
                : ['key' => $host ?: 'unknown', 'name' => $host ?: '未知目标', 'short' => strtoupper(substr($host ?: '?', 0, 2)), 'color' => '#64748b'];
            $key = $metadata['key'];
            if (!isset($groups[$key])) {
                $groups[$key] = $metadata + [
                    'connections' => 0,
                    'upload_bytes' => 0,
                    'download_bytes' => 0,
                ];
            }
            $groups[$key]['connections'] += (int) $row->connections;
            $groups[$key]['upload_bytes'] += (int) $row->upload_bytes;
            $groups[$key]['download_bytes'] += (int) $row->download_bytes;
        }

        $rows = collect($groups)->values();
        $rows = $rows->sortByDesc(fn (array $row): int => $sort === 'connections'
            ? $row['connections']
            : $row['upload_bytes'] + $row['download_bytes']
        )->values();
        $groupBytes = $rows->sum(fn (array $row): int => $row['upload_bytes'] + $row['download_bytes']);
        $rows = $rows->map(function (array $row) use ($groupBytes): array {
            $row['total_bytes'] = $row['upload_bytes'] + $row['download_bytes'];
            $row['share'] = $groupBytes > 0
                ? round($row['total_bytes'] * 100 / $groupBytes, 1)
                : 0.0;
            return $row;
        })->take(50)->values()->all();

        return [
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'dimension' => $dimension,
            'sort' => $sort,
            'cards' => [
                'upload_bytes' => (int) ($totals->upload_bytes ?? 0),
                'download_bytes' => (int) ($totals->download_bytes ?? 0),
                'total_bytes' => (int) ($totals->upload_bytes ?? 0) + (int) ($totals->download_bytes ?? 0),
                'connections' => (int) ($totals->connections ?? 0),
            ],
            'rows' => $rows,
        ];
    }

    public function platformTraffic(array $filters = []): array
    {
        [$from, $to] = self::resolveRange($filters);
        $fromTimestamp = $from->timestamp;
        $toTimestamp = $to->timestamp;
        $userId = !empty($filters['user_id']) ? (int) $filters['user_id'] : null;
        $serverId = !empty($filters['node_id']) && ctype_digit((string) $filters['node_id'])
            ? (int) $filters['node_id']
            : null;

        $userQuery = DB::table('v2_stat_user')
            ->whereBetween('record_at', [$fromTimestamp, $toTimestamp])
            ->when($userId, fn (Builder $query) => $query->where('user_id', $userId));
        $serverQuery = DB::table('v2_stat_server')
            ->whereBetween('record_at', [$fromTimestamp, $toTimestamp])
            ->when($serverId, fn (Builder $query) => $query->where('server_id', $serverId));

        $totals = (clone $userQuery)->selectRaw(
            'COALESCE(SUM(u),0) upload_bytes, COALESCE(SUM(d),0) download_bytes'
        )->first();

        return [
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'cards' => [
                'upload_bytes' => (int) ($totals->upload_bytes ?? 0),
                'download_bytes' => (int) ($totals->download_bytes ?? 0),
                'total_bytes' => (int) ($totals->upload_bytes ?? 0) + (int) ($totals->download_bytes ?? 0),
            ],
            'users' => $userQuery
                ->selectRaw('user_id, COALESCE(SUM(u),0) upload_bytes, COALESCE(SUM(d),0) download_bytes')
                ->groupBy('user_id')
                ->orderByDesc(DB::raw('SUM(u + d)'))
                ->limit(30)
                ->get(),
            'nodes' => $serverQuery
                ->selectRaw('server_id node_id, COALESCE(SUM(u),0) upload_bytes, COALESCE(SUM(d),0) download_bytes')
                ->groupBy('server_id')
                ->orderByDesc(DB::raw('SUM(u + d)'))
                ->get(),
        ];
    }

    /**
     * Build an audit coverage view for every enabled logical node.
     *
     * Health deliberately ignores user/action/destination filters: those
     * dimensions describe what to inspect, not whether a node is reporting.
     * The selected time range and optional node filter still apply.
     */
    public function health(array $filters = []): array
    {
        [$from, $to] = self::resolveRange($filters);
        $query = DB::table('v2_traffic_audit_events')
            ->whereBetween('occurred_at', [$from, $to])
            ->when(!empty($filters['node_id']), fn (Builder $q) => $q->where('node_id', $filters['node_id']))
            ->whereNotNull('node_id')
            ->selectRaw(
                'node_id, COUNT(*) events, ' .
                'COUNT(DISTINCT COALESCE(connection_id,event_id)) connections, ' .
                'COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN COALESCE(connection_id,event_id) END) linked_connections, ' .
                'COUNT(DISTINCT CASE WHEN route_id IS NOT NULL OR route_tag IS NOT NULL THEN COALESCE(connection_id,event_id) END) route_identified_connections, ' .
                'COALESCE(SUM(upload_bytes),0) upload_bytes, ' .
                'COALESCE(SUM(download_bytes),0) download_bytes, ' .
                'MAX(occurred_at) last_event_at'
            )
            ->groupBy('node_id');

        $eventNodes = $query->get()->keyBy(fn ($row) => (string) $row->node_id);
        $servers = Server::query()
            ->where(function ($q): void {
                $q->whereNull('parent_id')->orWhere('parent_id', 0);
            })
            ->where(function ($q): void {
                $q->whereNull('enabled')->orWhere('enabled', true);
            })
            ->when(!empty($filters['node_id']) && ctype_digit((string) $filters['node_id']), fn ($q) => $q->where('id', (int) $filters['node_id']))
            ->orderBy('sort')
            ->orderBy('id')
            ->get(['id', 'name', 'type', 'machine_id']);

        $now = now()->utc();
        $rows = $servers->map(function (Server $server) use ($eventNodes, $now): array {
            $nodeId = (string) $server->id;
            $event = $eventNodes->get($nodeId);
            $connections = (int) ($event->connections ?? 0);
            $linked = (int) ($event->linked_connections ?? 0);
            $routeIdentified = (int) ($event->route_identified_connections ?? 0);
            $lastEventAt = $event->last_event_at ?? null;

            if (!$lastEventAt) {
                $status = 'no_events';
                $statusLabel = '所选时段无事件';
            } else {
                $lastEventUtc = CarbonImmutable::parse((string) $lastEventAt, 'UTC')->utc();
                $ageSeconds = max(0, $now->diffInSeconds($lastEventUtc, false) * -1);
                if ($ageSeconds <= 900) {
                    $status = 'healthy';
                    $statusLabel = '正常';
                } elseif ($ageSeconds <= 21600) {
                    $status = 'delayed';
                    $statusLabel = '延迟';
                } else {
                    $status = 'stale';
                    $statusLabel = '长时间无事件';
                }
            }

            return [
                'node_id' => $nodeId,
                'node_name' => $server->name,
                'protocol' => $server->type,
                'machine_id' => $server->machine_id,
                'last_event_at' => $lastEventAt,
                'events' => (int) ($event->events ?? 0),
                'connections' => $connections,
                'linked_connections' => $linked,
                'unlinked_connections' => max(0, $connections - $linked),
                'user_link_rate' => $connections > 0 ? round($linked * 100 / $connections, 1) : null,
                'route_identified_connections' => $routeIdentified,
                'route_missing_connections' => max(0, $connections - $routeIdentified),
                'route_identity_rate' => $connections > 0 ? round($routeIdentified * 100 / $connections, 1) : null,
                'upload_bytes' => (int) ($event->upload_bytes ?? 0),
                'download_bytes' => (int) ($event->download_bytes ?? 0),
                'health_status' => $status,
                'health_label' => $statusLabel,
            ];
        })->values();

        $connections = $rows->sum('connections');
        $linked = $rows->sum('linked_connections');
        $routeIdentified = $rows->sum('route_identified_connections');
        $statusCounts = $rows->countBy('health_status');

        return [
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'summary' => [
                'nodes' => $rows->count(),
                'healthy' => (int) ($statusCounts['healthy'] ?? 0),
                'delayed' => (int) ($statusCounts['delayed'] ?? 0),
                'stale' => (int) ($statusCounts['stale'] ?? 0),
                'no_events' => (int) ($statusCounts['no_events'] ?? 0),
                'connections' => $connections,
                'user_link_rate' => $connections > 0 ? round($linked * 100 / $connections, 1) : null,
                'route_identity_rate' => $connections > 0 ? round($routeIdentified * 100 / $connections, 1) : null,
            ],
            'nodes' => $rows->all(),
        ];
    }

    public static function resolveRange(array $filters): array
    {
        $to = isset($filters['to'])
            ? CarbonImmutable::parse($filters['to'])->utc()
            : now()->utc()->toImmutable();
        $range = $filters['range'] ?? '24h';
        $from = isset($filters['from'])
            ? CarbonImmutable::parse($filters['from'])->utc()
            : match ($range) {
                '1h' => $to->subHour(),
                '6h' => $to->subHours(6),
                '7d' => $to->subDays(7),
                '14d' => $to->subDays(14),
                default => $to->subDay(),
            };
        return [$from, $to];
    }

    private function filteredQuery(array $filters, CarbonImmutable $from, CarbonImmutable $to): Builder
    {
        return DB::table('v2_traffic_audit_events')
            ->whereBetween('occurred_at', [$from, $to])
            ->when(!empty($filters['user_id']), fn (Builder $q) => $q->where('user_id', (int) $filters['user_id']))
            ->when(!empty($filters['node_id']), fn (Builder $q) => $q->where('node_id', $filters['node_id']))
            ->when(!empty($filters['action']), fn (Builder $q) => $q->where('action', $filters['action']))
            ->when(!empty($filters['route_id']), fn (Builder $q) => $q->where('route_id', (int) $filters['route_id']))
            ->when(!empty($filters['destination']), fn (Builder $q) => $q->where(
                'destination',
                'like',
                '%' . addcslashes((string) $filters['destination'], '%_\\') . '%'
            ));
    }

    private function destinationHost(string $destination): string
    {
        $value = strtolower(trim($destination));
        $value = preg_replace('/^(?:tcp|udp):/', '', $value) ?? $value;
        if ($value === '') {
            return '';
        }
        if (preg_match('/^\[([^\]]+)](?::[0-9]+)?$/', $value, $matches)) {
            return rtrim($matches[1], '.');
        }
        if (substr_count($value, ':') === 1) {
            [$host] = explode(':', $value, 2);
            return rtrim($host, '.');
        }
        if (substr_count($value, ':') > 1) {
            if (filter_var($value, FILTER_VALIDATE_IP)) {
                return $value;
            }
            if (preg_match('/^(.+):[0-9]+$/', $value, $matches)) {
                return rtrim($matches[1], '.');
            }
        }
        return rtrim($value, '.');
    }

    private function classifyService(string $host): array
    {
        foreach (self::SERVICE_CATALOG as $service) {
            foreach ($service['domains'] as $domain) {
                if ($host === $domain || str_ends_with($host, '.' . $domain)) {
                    return [
                        'key' => $service['key'],
                        'name' => $service['name'],
                        'short' => $service['short'],
                        'color' => $service['color'],
                    ];
                }
            }
        }
        return ['key' => 'other', 'name' => '其他', 'short' => '?', 'color' => '#64748b'];
    }
}
