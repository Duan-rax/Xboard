<?php

namespace App\Services\TrafficAudit;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TrafficAuditService
{
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
}
