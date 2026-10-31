<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Models\Server;
use App\Models\ServerRoute;
use App\Services\NodeCapabilityService;
use App\Services\NodeSyncService;
use App\Services\RouteRuleAnalyzer;
use App\Services\RouteRuleSimulator;
use App\Services\RoutePresetService;
use App\Services\RouteRuleValidator;
use App\Services\ServerService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use App\Models\EgressProxy;

class RouteController extends Controller
{
    public function fetch(Request $request)
    {
        $routes = ServerRoute::query()
            ->orderBy('priority')
            ->orderBy('id')
            ->get();
        [$bindingsByRoute, $outboundTagsByServer] = $this->routeTopology();
        $analysis = RouteRuleAnalyzer::analyze(
            $routes->all(),
            $bindingsByRoute,
            $outboundTagsByServer
        );
        $capabilitiesByServer = $this->nodeCapabilities();

        $routes->each(function (ServerRoute $route) use ($bindingsByRoute, $analysis, $capabilitiesByServer) {
            $routeId = (int) $route->id;
            $route->setAttribute('servers_count', count($bindingsByRoute[$routeId] ?? []));
            $route->setAttribute('diagnostics', array_merge(
                $analysis[$routeId] ?? [],
                $this->capabilityDiagnostics(
                    $this->criteriaForRoute($route),
                    (string) $route->action,
                    (string) ($route->match_mode ?: 'any'),
                    $bindingsByRoute[$routeId] ?? [],
                    $capabilitiesByServer
                )
            ));
        });
        return [
            'data' => $routes
        ];
    }

    public function save(Request $request)
    {
        $params = $request->validate([
            'remarks' => 'required|string|max:255',
            'match' => 'nullable|array',
            'criteria' => 'nullable|array',
            'match_mode' => 'nullable|in:any,all',
            'priority' => 'nullable|integer|min:0|max:100000',
            'enabled' => 'nullable|boolean',
            'action' => 'required|in:block,direct,dns,proxy',
            'action_value' => 'nullable|string|max:255'
        ], [
            'remarks.required' => '备注不能为空',
            'action.required' => '动作类型不能为空',
            'action.in' => '动作类型参数有误'
        ]);
        $params['match'] = array_values(array_filter($params['match'] ?? []));
        $params['criteria'] = $request->has('criteria')
            ? RouteRuleValidator::normalizeCriteria($params['criteria'] ?? [])
            : null;
        $params['action_value'] = $params['action'] === 'proxy'
            ? trim((string) ($params['action_value'] ?? ''))
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
                $this->notifyNodeConfigs($this->boundServerIds([(int) $route->id]));
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
        $changedRouteIds = [];
        DB::transaction(function () use ($params, &$changedRouteIds) {
            foreach ($params['items'] as $item) {
                $route = ServerRoute::find($item['id']);
                if ($route && $route->priority !== (int) $item['priority']) {
                    $route->priority = (int) $item['priority'];
                    $route->save();
                    $changedRouteIds[] = (int) $route->id;
                }
            }
        });
        if ($changedRouteIds !== []) {
            $this->notifyNodeConfigs($this->boundServerIds($changedRouteIds));
        }
        return $this->success(true);
    }

    public function options()
    {
        $targets = [];
        foreach (Server::query()->select(['id', 'custom_outbounds'])->whereNotNull('custom_outbounds')->get() as $server) {
            foreach ($server->custom_outbounds ?: [] as $outbound) {
                $tag = trim((string) ($outbound['tag'] ?? ''));
                if ($tag === '') continue;
                $targets[$tag] ??= ['label' => $tag, 'server_ids' => []];
                $targets[$tag]['server_ids'][] = (int) $server->id;
            }
        }
        ksort($targets);
        return $this->success([
            'targets' => collect($targets)->map(fn ($target, $tag) => [
                'tag' => $tag,
                'label' => $target['label'],
                'server_count' => count(array_unique($target['server_ids'])),
            ])->values(),
            'nodes' => Server::query()
                ->select(['id', 'name', 'host', 'enabled', 'type', 'metrics', 'egress_proxy_id'])
                ->orderBy('name')
                ->get()
                ->map(function (Server $server) {
                    $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
                    return [
                        'id' => (int) $server->id,
                        'name' => $server->name,
                        'host' => $server->host,
                        'type' => $server->type,
                        'enabled' => (bool) $server->enabled,
                        'kernel' => $capabilities['kernel'],
                    ];
                })
                ->values(),
            'presets' => RoutePresetService::definitions(),
            'egress_proxies' => EgressProxy::query()
                ->withCount('servers')
                ->where('enabled', true)
                ->orderBy('name')
                ->get(['id', 'name', 'protocol'])
                ->map(fn (EgressProxy $proxy) => [
                    'id' => (int) $proxy->id,
                    'name' => $proxy->name,
                    'protocol' => $proxy->protocol,
                    'servers_count' => (int) $proxy->servers_count,
                ])
                ->values(),
        ]);
    }

    public function applyPresets(Request $request, RoutePresetService $presets)
    {
        $params = $request->validate([
            'egress_proxy_id' => 'required|integer|min:1|exists:v2_egress_proxy,id',
        ]);
        return $this->success($presets->applyAll((int) $params['egress_proxy_id']));
    }

    public function simulate(Request $request)
    {
        $params = $request->validate([
            'server_id' => 'required|integer|min:1|exists:v2_server,id',
            'destination' => 'required|string|max:255',
            'destination_ip' => 'nullable|ip',
            'port' => 'nullable|integer|between:1,65535',
            'network' => 'nullable|in:tcp,udp',
            'source_ip' => 'nullable|ip',
            'source_port' => 'nullable|integer|between:1,65535',
            'protocol' => 'nullable|in:http,tls,quic,bittorrent',
        ]);
        $server = Server::query()
            ->select(['id', 'name', 'host', 'type', 'route_ids', 'egress_proxy_id', 'metrics', 'custom_routes'])
            ->with(['egressProxy:id,name,enabled'])
            ->findOrFail((int) $params['server_id']);
        $routeIds = $this->normalizeRouteIds($server->route_ids);
        $routes = ServerRoute::query()
            ->whereIn('id', $routeIds)
            ->orderBy('priority')
            ->orderBy('id')
            ->get();
        $destination = trim((string) $params['destination']);
        $destinationIp = trim((string) ($params['destination_ip'] ?? ''));
        $domain = filter_var($destination, FILTER_VALIDATE_IP) === false ? $destination : '';
        if ($destinationIp === '' && filter_var($destination, FILTER_VALIDATE_IP) !== false) {
            $destinationIp = $destination;
        }
        $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
        $metrics = $server->metrics ?? [];
        $result = RouteRuleSimulator::simulate($routes, [
            'id' => (int) $server->id,
            'name' => $server->name,
            'host' => $server->host,
            'type' => $server->type,
            'route_ids' => $routeIds,
            'kernel' => $capabilities['kernel'],
            'domain_strategy' => (string) ($metrics['domain_strategy'] ?? 'AsIs'),
            'egress_proxy_id' => (int) ($server->egress_proxy_id ?? 0),
            'egress_proxy_enabled' => (bool) ($server->egressProxy?->enabled ?? false),
            'custom_routes' => $server->custom_routes ?? [],
        ], [
            'destination' => $destination,
            'domain' => $domain,
            'destination_ip' => $destinationIp,
            'port' => isset($params['port']) ? (int) $params['port'] : null,
            'network' => strtolower((string) ($params['network'] ?? '')),
            'source_ip' => trim((string) ($params['source_ip'] ?? '')),
            'source_port' => isset($params['source_port']) ? (int) $params['source_port'] : null,
            'protocol' => strtolower((string) ($params['protocol'] ?? '')),
        ]);
        return $this->success($result);
    }

    /** Paginated node picker for attaching a route group to existing nodes. */
    public function nodes(Request $request)
    {
        $params = $request->validate([
            'route_id' => 'required|integer|min:1|exists:v2_server_route,id',
            'page' => 'nullable|integer|min:1',
            'page_size' => 'nullable|integer|between:1,100',
            'search' => 'nullable|string|max:128',
            'bound' => 'nullable|in:all,bound,unbound',
        ]);
        $route = ServerRoute::findOrFail((int) $params['route_id']);
        $pageSize = (int) ($params['page_size'] ?? 50);
        $search = trim((string) ($params['search'] ?? ''));
        $bound = $params['bound'] ?? 'all';
        $routeId = (int) $route->id;

        $query = Server::query()
            ->select(['id', 'name', 'host', 'port', 'type', 'enabled', 'machine_id', 'route_ids', 'custom_outbounds'])
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('host', 'like', "%{$search}%");
                });
            })
            ->orderByDesc('id');

        // JSON containment differs between MySQL and SQLite. Filter IDs in
        // PHP first, then let the regular paginator handle the selected set.
        if ($bound !== 'all') {
            $matchingIds = Server::query()->select(['id', 'route_ids'])->get()
                ->filter(function (Server $server) use ($routeId, $bound) {
                    $contains = in_array($routeId, $this->normalizeRouteIds($server->route_ids), true);
                    return $bound === 'bound' ? $contains : !$contains;
                })
                ->pluck('id');
            $query->whereIn('id', $matchingIds);
        }

        $paginator = $query->paginate($pageSize);
        $target = $route->action === 'proxy' ? trim((string) $route->action_value) : '';
        $criteria = $this->criteriaForRoute($route);
        return $this->success([
            'items' => collect($paginator->items())->map(function (Server $server) use ($route, $routeId, $target, $criteria) {
                $tags = collect($server->custom_outbounds ?: [])
                    ->pluck('tag')->map(fn ($tag) => trim((string) $tag))->filter()->values();
                $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
                return [
                    'id' => (int) $server->id,
                    'name' => $server->name,
                    'host' => $server->host,
                    'port' => (int) $server->port,
                    'type' => $server->type,
                    'enabled' => (bool) $server->enabled,
                    'machine_id' => $server->machine_id,
                    'bound' => in_array($routeId, $this->normalizeRouteIds($server->route_ids), true),
                    'online' => NodeSyncService::isNodeOnline((int) $server->id),
                    // False is a warning, not a hard rejection: a node may
                    // define the target in its local custom_config.
                    'target_known' => $target === '' || $tags->contains($target),
                    'capabilities' => $capabilities,
                    'compatibility' => NodeCapabilityService::evaluate(
                        $criteria,
                        (string) $route->action,
                        (string) ($route->match_mode ?: 'any'),
                        $capabilities
                    ),
                ];
            })->values(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /** Attach or detach one route from one or more nodes. */
    public function bind(Request $request)
    {
        $params = $request->validate([
            'route_id' => 'required|integer|min:1|exists:v2_server_route,id',
            'server_ids' => 'required|array|min:1|max:500',
            'server_ids.*' => 'integer|min:1|distinct',
            'bound' => 'required|boolean',
        ]);
        $routeId = (int) $params['route_id'];
        $bound = (bool) $params['bound'];
        $ids = collect($params['server_ids'])->map(fn ($id) => (int) $id)->unique()->values();
        $changedIds = collect();
        $route = ServerRoute::findOrFail($routeId);
        if ($bound) {
            $criteria = $this->criteriaForRoute($route);
            $incompatible = [];
            foreach (Server::query()->whereIn('id', $ids)->get() as $server) {
                $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
                $compatibility = NodeCapabilityService::evaluate(
                    $criteria,
                    (string) $route->action,
                    (string) ($route->match_mode ?: 'any'),
                    $capabilities
                );
                if ($compatibility['supported'] === false) {
                    $incompatible[] = "{$server->name} (#{$server->id}): "
                        . implode(', ', $compatibility['missing_features']);
                }
            }
            if ($incompatible !== []) {
                throw ValidationException::withMessages([
                    'server_ids' => ['所选节点不支持此规则：' . implode('；', $incompatible)],
                ]);
            }
        }

        DB::transaction(function () use ($ids, $routeId, $bound, $changedIds) {
            $servers = Server::query()->whereIn('id', $ids)->lockForUpdate()->get();
            if ($servers->count() !== $ids->count()) {
                throw ValidationException::withMessages([
                    'server_ids' => ['存在已被删除的节点，请刷新后重试。'],
                ]);
            }
            foreach ($servers as $server) {
                $routeIds = collect($this->normalizeRouteIds($server->route_ids));
                $before = $routeIds->all();
                $routeIds = $bound
                    ? $routeIds->push($routeId)->unique()->values()
                    : $routeIds->reject(fn ($id) => $id === $routeId)->values();
                if ($routeIds->all() === $before) continue;
                $server->route_ids = $routeIds->all();
                $server->save();
                $changedIds->push((int) $server->id);
            }
        });

        $requestedAt = time();
        $this->clearAppliedConfig($changedIds);
        $this->notifyNodeConfigs($changedIds);
        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => $ids,
            'route_id' => $routeId,
            'bound' => $bound,
            'requested_at' => $requestedAt,
            'sync' => $this->waitForNodeSync($changedIds, $requestedAt),
        ]);
    }

    public function bindStatus(Request $request)
    {
        $params = $request->validate([
            'server_ids' => 'required|array|max:500',
            'server_ids.*' => 'integer|min:1|distinct',
            'requested_at' => 'required|integer|min:1',
        ]);
        return $this->success([
            'sync' => $this->waitForNodeSync($params['server_ids'], (int) $params['requested_at'], 0),
        ]);
    }

    public function toggle(Request $request)
    {
        $params = $request->validate([
            'id' => 'required|integer|min:1',
            'enabled' => 'required|boolean',
        ]);
        $route = ServerRoute::findOrFail((int) $params['id']);
        $route->enabled = (bool) $params['enabled'];
        $route->save();
        $serverIds = $this->boundServerIds([(int) $route->id]);
        $this->clearAppliedConfig($serverIds);
        $this->notifyNodeConfigs($serverIds);
        return $this->success($route->fresh());
    }

    public function preview(Request $request)
    {
        $params = $request->validate([
            'id' => 'nullable|integer|min:1',
            'match' => 'nullable|array',
            'criteria' => 'nullable|array',
            'match_mode' => 'nullable|in:any,all',
            'priority' => 'nullable|integer|min:0|max:100000',
            'enabled' => 'nullable|boolean',
            'action' => 'required|in:block,direct,dns,proxy',
            'action_value' => 'nullable|string|max:255',
        ]);
        $legacyMatch = array_values(array_filter($params['match'] ?? []));
        $criteria = RouteRuleValidator::normalizeCriteria($params['criteria'] ?? []);
        $mode = $params['match_mode'] ?? 'any';
        $actionValue = trim((string) ($params['action_value'] ?? ''));
        $target = $params['action'] === 'proxy'
            ? $actionValue
            : ($actionValue !== '' ? $actionValue : null);
        RouteRuleValidator::assertUsable(
            $criteria,
            $legacyMatch,
            $params['action'],
            $target,
            $mode
        );
        $candidateId = (int) ($params['id'] ?? 0);
        $candidate = [
            'id' => $candidateId,
            'criteria' => $criteria,
            'match' => $legacyMatch,
            'match_mode' => $mode,
            'priority' => (int) ($params['priority'] ?? 100),
            'enabled' => $request->boolean('enabled', true),
            'action' => $params['action'],
            'action_value' => $target,
        ];
        $routes = ServerRoute::query()
            ->when($candidateId > 0, fn ($query) => $query->where('id', '!=', $candidateId))
            ->get()->all();
        $routes[] = $candidate;
        [$bindingsByRoute, $outboundTagsByServer] = $this->routeTopology();
        $analysis = RouteRuleAnalyzer::analyze($routes, $bindingsByRoute, $outboundTagsByServer);
        $diagnostics = $analysis[$candidateId] ?? [];
        if ($candidateId > 0) {
            $diagnostics = array_merge(
                $diagnostics,
                $this->capabilityDiagnostics(
                    $criteria,
                    $params['action'],
                    $mode,
                    $bindingsByRoute[$candidateId] ?? [],
                    $this->nodeCapabilities()
                )
            );
        }

        return $this->success([
            'criteria' => $criteria,
            'legacy_match' => $legacyMatch,
            'match_mode' => $mode,
            'action' => $params['action'],
            'target' => $target,
            'expanded_rule_count' => RouteRuleValidator::expandedRuleCount($criteria, $mode),
            'estimated_bytes' => strlen(json_encode($criteria, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
            'diagnostics' => $diagnostics,
            'warnings' => array_values(array_filter(array_merge(
                RouteRuleValidator::hasCriteria($criteria) ? [] : [
                    '该规则将继续使用旧版匹配格式。',
                ],
                array_map(fn ($diagnostic) => $diagnostic['message'] ?? null, $diagnostics)
            ))),
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
        $route = ServerRoute::findOrFail($routeId);
        $criteria = $this->criteriaForRoute($route);
        $statuses = $servers->map(function (Server $server) use ($route, $criteria) {
            $expected = ServerService::buildNodeConfig($server);
            $applied = Cache::get("node_config_applied:{$server->id}");
            $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
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
                'capabilities' => $capabilities,
                'compatibility' => NodeCapabilityService::evaluate(
                    $criteria,
                    (string) $route->action,
                    (string) ($route->match_mode ?: 'any'),
                    $capabilities
                ),
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
        $serverIds = $this->boundServerIds([(int) $route->id]);
        DB::transaction(function () use ($route, $serverIds) {
            foreach (Server::query()->whereIn('id', $serverIds)->lockForUpdate()->get() as $server) {
                $server->route_ids = collect($this->normalizeRouteIds($server->route_ids))
                    ->reject(fn ($id) => $id === (int) $route->id)->values()->all();
                $server->save();
            }
            if (!$route->delete()) throw new ApiException('删除失败');
        });
        $requestedAt = time();
        $this->clearAppliedConfig($serverIds);
        $this->notifyNodeConfigs($serverIds);
        return $this->success([
            'removed_bindings' => $serverIds->count(),
            'sync' => $this->waitForNodeSync($serverIds, $requestedAt),
        ]);
    }

    private function routeTopology(): array
    {
        $bindingsByRoute = [];
        $outboundTagsByServer = [];

        foreach (Server::query()->select(['id', 'route_ids', 'custom_outbounds'])->get() as $server) {
            $serverId = (int) $server->id;
            foreach ($this->normalizeRouteIds($server->route_ids) as $routeId) {
                $bindingsByRoute[$routeId] ??= [];
                $bindingsByRoute[$routeId][] = $serverId;
            }
            $outboundTagsByServer[$serverId] = collect($server->custom_outbounds ?: [])
                ->pluck('tag')
                ->map(fn ($tag) => trim((string) $tag))
                ->filter()
                ->values()
                ->all();
        }

        return [$bindingsByRoute, $outboundTagsByServer];
    }

    private function criteriaForRoute(ServerRoute $route): array
    {
        if (RouteRuleValidator::hasCriteria($route->criteria)) {
            return RouteRuleValidator::normalizeCriteria($route->criteria ?? []);
        }
        return RouteRuleValidator::criteriaFromLegacyMatch($route->match ?? []);
    }

    private function nodeCapabilities(): array
    {
        $result = [];
        foreach (Server::query()->select(['id', 'type', 'parent_id'])->get() as $server) {
            $result[(int) $server->id] = NodeCapabilityService::fromMetrics($server->metrics);
        }
        return $result;
    }

    private function capabilityDiagnostics(
        array $criteria,
        string $action,
        string $matchMode,
        iterable $serverIds,
        array $capabilitiesByServer
    ): array {
        $incompatibleServerIds = [];
        $unknownServerIds = [];
        $missingByServer = [];
        foreach ($serverIds as $serverId) {
            $capabilities = $capabilitiesByServer[(int) $serverId]
                ?? ['known' => false, 'features' => []];
            $compatibility = NodeCapabilityService::evaluate(
                $criteria,
                $action,
                $matchMode,
                $capabilities
            );
            if ($compatibility['supported'] === false) {
                $incompatibleServerIds[] = (int) $serverId;
                $missingByServer[(int) $serverId] = $compatibility['missing_features'];
            } elseif ($compatibility['supported'] === null) {
                $unknownServerIds[] = (int) $serverId;
            }
        }
        $diagnostics = [];
        if ($incompatibleServerIds !== []) {
            $diagnostics[] = [
                'code' => 'node_capability_mismatch',
                'severity' => 'error',
                'server_ids' => $incompatibleServerIds,
                'missing_by_server' => $missingByServer,
                'message' => count($incompatibleServerIds)
                    . ' 个绑定节点的内核不支持该规则所需的匹配能力。',
            ];
        }
        if ($unknownServerIds !== []) {
            $diagnostics[] = [
                'code' => 'node_capabilities_unknown',
                'severity' => 'info',
                'server_ids' => $unknownServerIds,
                'message' => '部分节点尚未上报内核能力，升级 Node 后会自动校验。',
            ];
        }
        return $diagnostics;
    }

    private function normalizeRouteIds(?array $routeIds): array
    {
        return collect($routeIds ?? [])->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)->unique()->values()->all();
    }

    private function boundServerIds(array $routeIds): Collection
    {
        $wanted = collect($routeIds)->map(fn ($id) => (int) $id)->flip();
        return Server::query()->select(['id', 'route_ids'])->get()
            ->filter(function (Server $server) use ($wanted) {
                foreach ($this->normalizeRouteIds($server->route_ids) as $routeId) {
                    if ($wanted->has($routeId)) return true;
                }
                return false;
            })->pluck('id')->map(fn ($id) => (int) $id)->values();
    }

    private function clearAppliedConfig(iterable $serverIds): void
    {
        foreach ($serverIds as $serverId) {
            Cache::forget("node_config_applied:" . (int) $serverId);
        }
    }

    private function notifyNodeConfigs(iterable $serverIds): void
    {
        foreach ($serverIds as $serverId) {
            NodeSyncService::notifyConfigUpdated((int) $serverId);
        }
    }

    private function waitForNodeSync(iterable $serverIds, int $requestedAt, float $timeout = 3.0): array
    {
        $pending = collect($serverIds)->map(fn ($id) => (int) $id)->unique()->values();
        $deadline = microtime(true) + max(0, $timeout);
        do {
            $pending = $pending->reject(function (int $serverId) use ($requestedAt) {
                $applied = Cache::get("node_config_applied:{$serverId}");
                return is_array($applied)
                    && (int) ($applied['applied_at'] ?? 0) >= $requestedAt;
            })->values();
            if ($pending->isEmpty() || $timeout <= 0) break;
            usleep(100_000);
        } while (microtime(true) < $deadline);

        $confirmed = collect($serverIds)->map(fn ($id) => (int) $id)->unique()
            ->diff($pending)->values();
        return [
            'confirmed_server_ids' => $confirmed,
            'pending_server_ids' => $pending,
        ];
    }
}
