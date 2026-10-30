<?php

namespace App\Http\Controllers\V2\Admin;

use App\Http\Controllers\Controller;
use App\Models\Server;
use App\Models\ServerRoute;
use App\Models\User;
use App\Services\TrafficAudit\TrafficAuditService;
use Illuminate\Http\Request;

class TrafficAuditController extends Controller
{
    public function __construct(private readonly TrafficAuditService $service)
    {
    }

    public function overview(Request $request)
    {
        $filters = $this->filters($request);
        $data = $this->service->overview($filters);
        $routeNames = ServerRoute::query()
            ->whereIn('id', collect($data['routes'])->pluck('route_id')->filter()->all())
            ->pluck('remarks', 'id');
        $nodeNames = Server::query()
            ->whereIn('id', collect($data['nodes'])->pluck('node_id')->filter()->map(fn ($id) => (int) $id)->all())
            ->pluck('name', 'id');
        $userNames = User::query()
            ->whereIn('id', collect($data['users'])->pluck('user_id')->filter()->all())
            ->pluck('email', 'id');

        $data['routes'] = collect($data['routes'])->map(function ($row) use ($routeNames) {
            $item = (array) $row;
            $item['route_name'] = $item['route_id']
                ? ($routeNames[(int) $item['route_id']] ?? null)
                : null;
            return $item;
        })->values()->all();
        $data['nodes'] = collect($data['nodes'])->map(function ($row) use ($nodeNames) {
            $item = (array) $row;
            $item['node_name'] = $nodeNames[(int) $item['node_id']] ?? null;
            return $item;
        })->values()->all();
        $data['users'] = collect($data['users'])->map(function ($row) use ($userNames) {
            $item = (array) $row;
            $item['user_name'] = $userNames[(int) $item['user_id']] ?? null;
            return $item;
        })->values()->all();
        return $this->success($data);
    }

    public function events(Request $request)
    {
        $filters = $this->filters($request);
        $data = $this->service->events($filters, (int) $request->input('per_page', 50));
        $routeNames = ServerRoute::query()
            ->whereIn('id', collect($data->items())->pluck('route_id')->filter()->all())
            ->pluck('remarks', 'id');
        $userNames = User::query()
            ->whereIn('id', collect($data->items())->pluck('user_id')->filter()->all())
            ->pluck('email', 'id');
        $data->getCollection()->transform(function ($row) use ($routeNames, $userNames) {
            $item = (array) $row;
            $item['route_name'] = $item['route_id']
                ? ($routeNames[(int) $item['route_id']] ?? null)
                : null;
            $item['user_name'] = $item['user_id']
                ? ($userNames[(int) $item['user_id']] ?? null)
                : null;
            return $item;
        });
        return $this->success($data);
    }

    public function settings()
    {
        return $this->success([
            'webhook_secret' => TrafficAuditService::webhookSecret(),
            'retention_days' => TrafficAuditService::retentionDays(),
            'clock_skew' => max(30, (int) admin_setting('traffic_audit_clock_skew', 300)),
            'ingest_url' => url('/api/v1/traffic-audit/events'),
        ]);
    }

    public function saveSettings(Request $request)
    {
        $params = $request->validate([
            'webhook_secret' => 'nullable|string|min:16|max:128',
            'retention_days' => 'required|integer|min:1|max:365',
            'clock_skew' => 'required|integer|min:30|max:3600',
            'generate_secret' => 'nullable|boolean',
        ]);
        $secret = trim((string) ($params['webhook_secret'] ?? ''));
        if ($request->boolean('generate_secret') || $secret === '') {
            $secret = bin2hex(random_bytes(24));
        }
        admin_setting([
            'traffic_audit_webhook_secret' => $secret,
            'traffic_audit_retention_days' => (int) $params['retention_days'],
            'traffic_audit_clock_skew' => (int) $params['clock_skew'],
        ]);
        return $this->success([
            'webhook_secret' => $secret,
            'retention_days' => (int) $params['retention_days'],
            'clock_skew' => (int) $params['clock_skew'],
        ]);
    }

    public function cleanup()
    {
        $deleted = \Illuminate\Support\Facades\DB::table('v2_traffic_audit_events')
            ->where('occurred_at', '<', now()->subDays(TrafficAuditService::retentionDays()))
            ->delete();
        return $this->success(['deleted' => $deleted]);
    }

    private function filters(Request $request): array
    {
        return $request->validate([
            'range' => 'nullable|in:1h,6h,24h,7d,14d',
            'from' => 'nullable|date',
            'to' => 'nullable|date',
            'user_id' => 'nullable|integer|min:1',
            'node_id' => 'nullable|string|max:128',
            'action' => 'nullable|string|max:32',
            'route_id' => 'nullable|integer|min:1',
            'destination' => 'nullable|string|max:255',
        ]);
    }
}
