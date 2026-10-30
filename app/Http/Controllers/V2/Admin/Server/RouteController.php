<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Models\EgressProxy;
use App\Models\Server;
use App\Models\ServerRoute;
use App\Services\RouteRuleValidator;
use App\Services\ServerService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RouteController extends Controller
{
    public function fetch(Request $request)
    {
        $routes = ServerRoute::query()
            ->orderBy('priority')
            ->orderBy('id')
            ->get();
        $serverCounts = [];
        foreach (Server::query()->select(['id', 'route_ids'])->get() as $server) {
            foreach ($server->route_ids ?? [] as $routeId) {
                $serverCounts[(int) $routeId] = ($serverCounts[(int) $routeId] ?? 0) + 1;
            }
        }
        $routes->each(function (ServerRoute $route) use ($serverCounts) {
            $route->setAttribute('servers_count', $serverCounts[(int) $route->id] ?? 0);
        });
        return [
            'data' => $routes
        ];
    }

    public function save(Request $request)
    {
        $params = $request->validate([
            'remarks' => 'required',
            'match' => 'nullable|array',
            'criteria' => 'nullable|array',
            'match_mode' => 'nullable|in:any,all',
            'priority' => 'nullable|integer|min:0|max:100000',
            'enabled' => 'nullable|boolean',
            'action' => 'required|in:block,direct,dns,proxy',
            'action_value' => 'nullable'
        ], [
            'remarks.required' => '备注不能为空',
            'action.required' => '动作类型不能为空',
            'action.in' => '动作类型参数有误'
        ]);
        $params['match'] = array_values(array_filter($params['match'] ?? []));
        $params['criteria'] = $request->has('criteria')
            ? RouteRuleValidator::normalizeCriteria($params['criteria'] ?? [])
            : null;
        RouteRuleValidator::assertUsable(
            $params['criteria'],
            $params['match'],
            $params['action'],
            $params['action_value'] ?? null,
            $params['match_mode'] ?? 'any'
        );
        $params['match_mode'] = $params['match_mode'] ?? 'any';
        $params['priority'] = (int) ($params['priority'] ?? 100);
        $params['enabled'] = $request->boolean('enabled', true);

        if ($request->input('id')) {
            try {
                $route = ServerRoute::findOrFail($request->input('id'));
                $route->update($params);
                return $this->success($route->fresh());
            } catch (\Exception $e) {
                Log::error($e);
                return $this->fail([500,'保存失败']);
            }
        }
        try{
            return $this->success(ServerRoute::create($params));
        }catch(\Exception $e){
            Log::error($e);
            return $this->fail([500,'创建失败']);
        }
    }

    public function sort(Request $request)
    {
        $params = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.id' => 'required|integer|min:1',
            'items.*.priority' => 'required|integer|min:0|max:100000',
        ]);
        DB::transaction(function () use ($params) {
            foreach ($params['items'] as $item) {
                $route = ServerRoute::find($item['id']);
                if ($route && $route->priority !== (int) $item['priority']) {
                    $route->priority = (int) $item['priority'];
                    $route->save();
                }
            }
        });
        return $this->success(true);
    }

    public function options()
    {
        $targets = [];
        foreach (Server::query()->whereNotNull('custom_outbounds')->pluck('custom_outbounds') as $outbounds) {
            foreach ($outbounds ?: [] as $outbound) {
                $tag = trim((string) ($outbound['tag'] ?? ''));
                if ($tag !== '') $targets[$tag] = $tag;
            }
        }
        foreach (EgressProxy::query()->get(['id', 'name']) as $proxy) {
            $tag = 'panel-egress-' . $proxy->id;
            $targets[$tag] = "{$proxy->name} ({$tag})";
        }
        ksort($targets);
        return $this->success([
            'targets' => collect($targets)->map(fn ($label, $tag) => [
                'tag' => $tag,
                'label' => $label,
            ])->values(),
        ]);
    }

    public function preview(Request $request)
    {
        $params = $request->validate([
            'match' => 'nullable|array',
            'criteria' => 'nullable|array',
            'match_mode' => 'nullable|in:any,all',
            'action' => 'required|in:block,direct,dns,proxy',
            'action_value' => 'nullable|string|max:255',
        ]);
        $legacyMatch = array_values(array_filter($params['match'] ?? []));
        $criteria = RouteRuleValidator::normalizeCriteria($params['criteria'] ?? []);
        $mode = $params['match_mode'] ?? 'any';
        RouteRuleValidator::assertUsable(
            $criteria,
            $legacyMatch,
            $params['action'],
            $params['action_value'] ?? null,
            $mode
        );
        return $this->success([
            'criteria' => $criteria,
            'legacy_match' => $legacyMatch,
            'match_mode' => $mode,
            'action' => $params['action'],
            'target' => $params['action_value'] ?? null,
            'expanded_rule_count' => RouteRuleValidator::expandedRuleCount($criteria, $mode),
            'estimated_bytes' => strlen(json_encode($criteria, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
            'warnings' => RouteRuleValidator::hasCriteria($criteria) ? [] : [
                '该规则将继续使用旧版匹配格式。',
            ],
        ]);
    }

    public function syncStatus(Request $request)
    {
        $routeId = (int) $request->validate([
            'route_id' => 'required|integer|min:1',
        ])['route_id'];
        ServerRoute::findOrFail($routeId);

        $servers = Server::query()->where('show', 1)->get()->filter(
            fn (Server $server) => in_array($routeId, $server->route_ids ?? [])
        );
        $statuses = $servers->map(function (Server $server) {
            $expected = ServerService::buildNodeConfig($server);
            $applied = Cache::get("node_config_applied:{$server->id}");
            $confirmed = is_array($applied)
                && (int) ($applied['config_revision'] ?? -1) >= (int) $expected['config_revision']
                && hash_equals(
                    (string) $expected['config_hash'],
                    (string) ($applied['config_hash'] ?? '')
                );
            return [
                'server_id' => (int) $server->id,
                'server_name' => $server->name,
                'expected_revision' => (int) $expected['config_revision'],
                'expected_hash' => $expected['config_hash'],
                'applied_revision' => (int) ($applied['config_revision'] ?? 0),
                'applied_hash' => (string) ($applied['config_hash'] ?? ''),
                'applied_at' => (int) ($applied['applied_at'] ?? 0),
                'confirmed' => $confirmed,
            ];
        })->values();

        return $this->success([
            'nodes' => $statuses,
            'confirmed' => $statuses->where('confirmed', true)->count(),
            'pending' => $statuses->where('confirmed', false)->count(),
        ]);
    }

    public function drop(Request $request)
    {
        $route = ServerRoute::find($request->input('id'));
        if (!$route) throw new ApiException('路由不存在');
        if (!$route->delete()) throw new ApiException('删除失败');
        return [
            'data' => true
        ];
    }
}
