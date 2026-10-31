<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\EgressProxy;
use App\Models\Server;
use App\Services\EgressProxyValidator;
use App\Services\EgressBindingService;
use App\Services\NodeCapabilityService;
use App\Services\NodeSyncService;
use App\Services\ServerService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\Process\Process;

class EgressProxyController extends Controller
{
    public function fetch(Request $request)
    {
        $params = $request->validate([
            'page' => 'nullable|integer|min:1',
            'page_size' => 'nullable|integer|between:1,100',
            'search' => 'nullable|string|max:128',
            'protocol' => 'nullable|in:' . implode(',', EgressProxyValidator::PROTOCOLS),
            'enabled' => 'nullable|boolean',
        ]);
        $pageSize = (int) ($params['page_size'] ?? 20);
        $search = trim((string) ($params['search'] ?? ''));

        $paginator = EgressProxy::query()
            ->withCount('servers')
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('host', 'like', "%{$search}%")
                        ->orWhere('protocol', 'like', "%{$search}%");
                });
            })
            ->when(isset($params['protocol']), fn ($query) => $query->where('protocol', $params['protocol']))
            ->when(isset($params['enabled']), fn ($query) => $query->where('enabled', (bool) $params['enabled']))
            ->orderByDesc('id')
            ->paginate($pageSize);

        return $this->success([
            'items' => collect($paginator->items())
                ->map(fn (EgressProxy $proxy) => $this->publicProxy($proxy))
                ->values(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /**
     * Paginated node picker used by the binding dialog. It deliberately does
     * not reuse /server/manage/getNodes, which loads every node and its
     * appended runtime statistics on each open.
     */
    public function nodes(Request $request)
    {
        $params = $request->validate([
            'page' => 'nullable|integer|min:1',
            'page_size' => 'nullable|integer|between:1,100',
            'search' => 'nullable|string|max:128',
            'bound' => 'nullable|in:all,bound,unbound',
            'egress_proxy_id' => 'nullable|integer|min:0',
            'current_egress_proxy_id' => 'nullable|integer|min:0',
            'probe_proxy_id' => 'nullable|integer|min:0',
        ]);
        $pageSize = (int) ($params['page_size'] ?? 50);
        $search = trim((string) ($params['search'] ?? ''));
        $bound = $params['bound'] ?? 'all';

        $paginator = Server::query()
            ->select(['id', 'name', 'host', 'port', 'type', 'enabled', 'machine_id', 'egress_proxy_id'])
            ->with([
                'egressProxy:id,name',
                'egressBindings:id,name,protocol',
            ])
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('host', 'like', "%{$search}%");
                });
            })
            ->when($bound === 'bound', fn ($query) => $query->has('egressBindings'))
            ->when($bound === 'unbound', fn ($query) => $query->doesntHave('egressBindings'))
            ->when(
                !empty($params['egress_proxy_id']),
                fn ($query) => $query->whereHas(
                    'egressBindings',
                    fn ($binding) => $binding->where('v2_egress_proxy.id', (int) $params['egress_proxy_id'])
                )
            )
            ->orderByDesc('id')
            ->paginate($pageSize);

        return $this->success([
            'items' => collect($paginator->items())->map(fn (Server $server) => [
                'id' => $server->id,
                'name' => $server->name,
                'host' => $server->host,
                'port' => (int) $server->port,
                'type' => $server->type,
                'enabled' => (bool) $server->enabled,
                'machine_id' => $server->machine_id,
                'egress_proxy_id' => $server->egress_proxy_id,
                'egress_proxy_name' => $server->egressProxy?->name,
                'is_default' => !empty($params['current_egress_proxy_id'])
                    && (int) $server->egress_proxy_id === (int) $params['current_egress_proxy_id'],
                'current_available' => !empty($params['current_egress_proxy_id'])
                    && $server->egressBindings->contains('id', (int) $params['current_egress_proxy_id']),
                'egress_bindings' => $server->egressBindings->map(fn (EgressProxy $proxy) => [
                    'id' => (int) $proxy->id,
                    'name' => $proxy->name,
                    'protocol' => $proxy->protocol,
                    'is_default' => (int) $server->egress_proxy_id === (int) $proxy->id,
                ])->values(),
                'probe_health' => !empty($params['probe_proxy_id'])
                    ? Cache::get('egress_health:' . (int) $params['probe_proxy_id'] . ':' . $server->id)
                    : null,
            ])->values(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    public function save(Request $request)
    {
        $params = $request->validate([
            'id' => 'nullable|integer',
            'name' => 'required|string|max:128',
            'protocol' => 'required|in:' . implode(',', EgressProxyValidator::PROTOCOLS),
            'host' => 'required|string|max:255',
            'port' => 'required|integer|between:1,65535',
            'username' => 'nullable|string|max:2048',
            'password' => 'nullable|string|max:2048',
            'tls_enabled' => 'nullable|boolean',
            'tls_server_name' => 'nullable|string|max:255',
            'allow_insecure' => 'nullable|boolean',
            'config' => 'nullable|array',
            'config.method' => 'nullable|string|max:128',
            'config.uuid' => 'nullable|string|max:128',
            'config.flow' => 'nullable|string|max:128',
            'config.network' => 'nullable|string|max:32',
            'config.fingerprint' => 'nullable|string|max:64',
            'config.reality' => 'nullable|array',
            'config.reality.public_key' => 'nullable|string|max:255',
            'config.reality.short_id' => 'nullable|string|max:64',
            'config.reality.fingerprint' => 'nullable|string|max:64',
            'enabled' => 'nullable|boolean',
            'clear_username' => 'nullable|boolean',
            'clear_password' => 'nullable|boolean',
        ]);

        $proxy = isset($params['id']) ? EgressProxy::findOrFail($params['id']) : new EgressProxy();
        unset($params['id']);

        $clearUsername = (bool) ($params['clear_username'] ?? false);
        $clearPassword = (bool) ($params['clear_password'] ?? false);
        unset($params['clear_username'], $params['clear_password']);

        $params['name'] = trim($params['name']);
        $params['host'] = trim($params['host']);
        if (str_starts_with($params['host'], '[') && str_ends_with($params['host'], ']')) {
            $unwrappedHost = substr($params['host'], 1, -1);
            if (filter_var($unwrappedHost, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
                $params['host'] = $unwrappedHost;
            }
        }
        if (isset($params['tls_server_name'])) {
            $params['tls_server_name'] = trim($params['tls_server_name']) ?: null;
        }
        if (array_key_exists('username', $params)) {
            $params['username'] = trim((string) $params['username']) ?: null;
        }
        if (array_key_exists('password', $params) && $params['password'] === '') {
            // Passwords can be whitespace-sensitive; only normalize an empty
            // string. Clearing a saved password remains an explicit action.
            $params['password'] = null;
        }
        if ($clearUsername) {
            $params['username'] = null;
        }
        if ($clearPassword) {
            $params['password'] = null;
        }

        // Keep the previous nested config only when the request omits it. The
        // admin form always posts the complete object it displayed.
        $config = array_key_exists('config', $params)
            ? (is_array($params['config']) ? $params['config'] : [])
            : ($proxy->config ?? []);
        $config = EgressProxyValidator::normalizeConfig($config);
        $params['config'] = $config;

        $errors = [];
        if ($params['name'] === '') {
            $errors['name'] = ['名称不能为空。'];
        }
        if ($params['host'] === '') {
            $errors['host'] = ['地址不能为空。'];
        } elseif (preg_match('/[\s\/]/', $params['host']) === 1) {
            $errors['host'] = ['地址不能包含空格或斜杠，请只填写主机名或 IP。'];
        } elseif (preg_match('/[\[\]]/', $params['host']) === 1) {
            $errors['host'] = ['IPv6 地址的方括号必须成对填写，或直接填写裸地址。'];
        } elseif (
            str_contains($params['host'], ':')
            && filter_var($params['host'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false
        ) {
            $errors['host'] = ['包含冒号的地址必须是有效的 IPv6 地址；端口请单独填写。'];
        }

        $effectivePassword = array_key_exists('password', $params)
            ? $params['password']
            : $proxy->password;
        $effectiveTlsServerName = array_key_exists('tls_server_name', $params)
            ? $params['tls_server_name']
            : $proxy->tls_server_name;
        $errors += EgressProxyValidator::errors(
            $params['protocol'],
            $config,
            $effectivePassword,
            $effectiveTlsServerName
        );
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $proxy->fill($params);
        $proxy->save();

        $this->syncBoundNodes($proxy);
        return $this->success($this->publicProxy($proxy));
    }

    public function drop(Request $request)
    {
        $id = $request->validate(['id' => 'required|integer'])['id'];
        $proxy = EgressProxy::findOrFail($id);
        $bound = $proxy->servers()->count();
        if ($bound > 0) {
            return $this->fail([400, "该出站代理仍绑定 {$bound} 个节点；请先解绑节点后再删除。"]);
        }
        $proxy->delete();
        return $this->success(true);
    }

    /**
     * Assign or clear an egress profile for one or more nodes without
     * exposing its credentials. egress_proxy_id = 0 means "unbind".
     */
    public function bind(Request $request, EgressBindingService $bindings)
    {
        $params = $request->validate([
            'server_id' => 'nullable|integer|min:1',
            'server_ids' => 'nullable|array|max:500',
            'server_ids.*' => 'integer|min:1|distinct',
            // A zero value is the UI's explicit "unbind" value. It is
            // converted to null below rather than being a phantom profile.
            'egress_proxy_id' => 'nullable|integer|min:0',
        ]);

        $ids = collect($params['server_ids'] ?? [])
            ->push($params['server_id'] ?? null)
            ->filter(fn ($id) => $id !== null)
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();
        if ($ids->isEmpty()) {
            throw ValidationException::withMessages([
                'server_ids' => ['请至少选择一个节点。'],
            ]);
        }

        $egressProxyId = (int) ($params['egress_proxy_id'] ?? 0);
        $proxy = $egressProxyId > 0 ? EgressProxy::findOrFail($egressProxyId) : null;

        $servers = Server::query()->whereIn('id', $ids)->get();
        if ($servers->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'server_ids' => ['存在已被删除的节点，请刷新后重试。'],
            ]);
        }

        $changedIds = DB::transaction(function () use ($bindings, $proxy, $servers, $ids) {
            if ($proxy) {
                return $bindings->setAvailability($proxy, $ids, true, true);
            }
            $changed = collect();
            foreach ($servers as $server) {
                $wasDefault = $server->egress_proxy_id !== null;
                DB::table('v2_server_egress_binding')
                    ->where('server_id', $server->id)
                    ->update(['is_default' => false, 'updated_at' => now()]);
                if ($wasDefault) {
                    $server->egress_proxy_id = null;
                    $server->save();
                    $changed->push((int) $server->id);
                }
            }
            return $changed;
        });
        $requestedAt = time();
        $this->finishBindingChange($changedIds);

        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => $ids,
            'egress_proxy_id' => $egressProxyId ?: null,
            'requested_at' => $requestedAt,
            'sync' => $this->waitForNodeSync($changedIds, $egressProxyId, $requestedAt),
        ]);
    }

    /**
     * Grant or revoke one outbound for nodes without changing its final-route
     * status unless make_default/clear_default is explicitly requested.
     */
    public function availability(Request $request, EgressBindingService $bindings)
    {
        $params = $request->validate([
            'egress_proxy_id' => 'required|integer|min:1|exists:v2_egress_proxy,id',
            'server_ids' => 'required|array|min:1|max:500',
            'server_ids.*' => 'integer|min:1|distinct|exists:v2_server,id',
            'available' => 'required|boolean',
            'make_default' => 'nullable|boolean',
            'clear_default' => 'nullable|boolean',
        ]);
        $proxy = EgressProxy::findOrFail((int) $params['egress_proxy_id']);
        $changedIds = DB::transaction(fn () => $bindings->setAvailability(
            $proxy,
            $params['server_ids'],
            (bool) $params['available'],
            (bool) ($params['make_default'] ?? false),
            (bool) ($params['clear_default'] ?? false)
        ));
        $requestedAt = time();
        $this->finishBindingChange($changedIds);
        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => collect($params['server_ids'])->map(fn ($id) => (int) $id)->values(),
            'changed_server_ids' => $changedIds,
            'egress_proxy_id' => $proxy->id,
            'available' => (bool) $params['available'],
            'make_default' => (bool) ($params['make_default'] ?? false),
            'requested_at' => $requestedAt,
            'expect_available' => (bool) $params['available'],
            'sync' => $this->waitForNodeSync(
                $changedIds,
                $proxy->id,
                $requestedAt,
                3.0,
                (bool) $params['available']
            ),
        ]);
    }

    /** Return current application status for a previous bind/unbind request. */
    public function bindStatus(Request $request)
    {
        $params = $request->validate([
            'server_ids' => 'required|array|max:500',
            'server_ids.*' => 'integer|min:1|distinct',
            'egress_proxy_id' => 'required|integer|min:0',
            'requested_at' => 'required|integer|min:1',
            'expect_available' => 'nullable|boolean',
        ]);

        return $this->success([
            'sync' => $this->waitForNodeSync(
                $params['server_ids'],
                (int) $params['egress_proxy_id'],
                (int) $params['requested_at'],
                0,
                isset($params['expect_available']) ? (bool) $params['expect_available'] : null
            ),
        ]);
    }

    /** Clear the binding for every node currently using a profile. */
    public function unbindAll(Request $request)
    {
        $egressProxyId = (int) $request->validate([
            'egress_proxy_id' => 'required|integer|min:1',
        ])['egress_proxy_id'];
        EgressProxy::findOrFail($egressProxyId);

        $proxy = EgressProxy::findOrFail($egressProxyId);
        $serverIds = $proxy->servers()->pluck('v2_server.id');
        $changedIds = DB::transaction(fn () => app(EgressBindingService::class)->setAvailability(
            $proxy,
            $serverIds,
            false
        ));
        $requestedAt = time();
        $this->finishBindingChange($changedIds);

        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => $serverIds,
            'egress_proxy_id' => $egressProxyId,
            'requested_at' => $requestedAt,
            'sync' => $this->waitForNodeSync($changedIds, $egressProxyId, $requestedAt, 3.0, false),
        ]);
    }

    /** Run a real proxy request through an isolated sing-box process. */
    public function test(Request $request)
    {
        $id = $request->validate(['id' => 'required|integer'])['id'];
        $proxy = EgressProxy::findOrFail($id);
        $binary = (string) (getenv('EGRESS_PROBE_BIN') ?: '/usr/local/bin/xboard-egress-probe');
        if (!is_executable($binary)) {
            return $this->success([
                'ok' => false,
                'latency_ms' => 0,
                'message' => '真实代理测试组件未安装。',
            ]);
        }
        try {
            $process = new Process([$binary], base_path(), null, null, 15.0);
            $process->setInput(json_encode($proxy->toNodeConfig(), JSON_THROW_ON_ERROR));
            $process->run();
            $payload = json_decode(trim($process->getOutput()), true);
        } catch (\Throwable $exception) {
            return $this->success([
                'ok' => false,
                'latency_ms' => 0,
                'message' => '真实代理测试超时或启动失败: ' . mb_substr($exception->getMessage(), 0, 500),
            ]);
        }
        if (!is_array($payload)) {
            $message = trim($process->getErrorOutput());
            return $this->success([
                'ok' => false,
                'latency_ms' => 0,
                'message' => $message !== ''
                    ? '真实代理测试失败: ' . mb_substr($message, 0, 500)
                    : '真实代理测试未返回有效结果。',
            ]);
        }
        return $this->success($payload);
    }

    /**
     * Execute a real probe from selected panel nodes. The panel never claims
     * that its own local reachability is equivalent to the node data path.
     */
    public function probe(Request $request)
    {
        $params = $request->validate([
            'id' => 'required|integer|min:1|exists:v2_egress_proxy,id',
            'server_ids' => 'required|array|min:1|max:10',
            'server_ids.*' => 'integer|min:1|distinct|exists:v2_server,id',
            'target' => 'nullable|url:http,https|max:2048',
        ]);
        $proxy = EgressProxy::findOrFail((int) $params['id']);
        $target = trim((string) ($params['target'] ?? ''));
        $requests = [];

        foreach (Server::query()->whereIn('id', $params['server_ids'])->get() as $server) {
            $requestId = bin2hex(random_bytes(16));
            $base = [
                'request_id' => $requestId,
                'server_id' => (int) $server->id,
                'server_name' => $server->name,
                'proxy_id' => (int) $proxy->id,
            ];
            if (!NodeSyncService::isNodeOnline((int) $server->id)) {
                $requests[] = $base + [
                    'ok' => false,
                    'latency_ms' => 0,
                    'message' => '节点离线，无法执行节点侧探测。',
                    'target' => $target ?: '/',
                ];
                continue;
            }
            $capabilities = NodeCapabilityService::fromMetrics($server->metrics);
            if (!in_array('node_egress_probe', $capabilities['features'] ?? [], true)) {
                $requests[] = $base + [
                    'ok' => false,
                    'latency_ms' => 0,
                    'message' => '节点版本尚不支持节点侧出站探测，请升级 Node。',
                    'target' => $target ?: '/',
                ];
                continue;
            }

            Cache::put("node_egress_probe:{$requestId}", ['status' => 'pending'], 30);
            $sent = NodeSyncService::push((int) $server->id, 'probe.egress', [
                'request_id' => $requestId,
                'proxy' => $proxy->toNodeConfig(),
                'target' => $target,
            ]);
            $requests[] = $base + [
                'request_id' => $requestId,
                'sent' => $sent,
            ];
        }

        $pending = collect($requests)
            ->filter(fn (array $result) => isset($result['sent']) && $result['sent'])
            ->keyBy('request_id');
        $deadline = microtime(true) + 14.0;
        while ($pending->isNotEmpty() && microtime(true) < $deadline) {
            foreach ($pending->keys() as $requestId) {
                $result = Cache::get("node_egress_probe:{$requestId}");
                if (is_array($result) && ($result['status'] ?? '') !== 'pending') {
                    $pending->forget($requestId);
                }
            }
            if ($pending->isNotEmpty()) {
                usleep(150_000);
            }
        }

        $items = collect($requests)->map(function (array $request) {
            if (empty($request['request_id'])) {
                return $request;
            }
            if (empty($request['sent'])) {
                return array_diff_key($request, ['sent' => true]) + [
                    'ok' => false,
                    'latency_ms' => 0,
                    'message' => '节点 WebSocket 暂不可用，请稍后重试。',
                    'target' => $request['target'] ?? '/',
                ];
            }
            $result = Cache::get("node_egress_probe:{$request['request_id']}");
            if (!is_array($result) || ($result['status'] ?? '') === 'pending') {
                return array_diff_key($request, ['sent' => true]) + [
                    'ok' => false,
                    'latency_ms' => 0,
                    'message' => '节点侧探测超时。',
                    'target' => $request['target'] ?? '/',
                ];
            }
            return array_merge($request, $result);
        })->values();

        return $this->success([
            'items' => $items,
            'proxy_id' => (int) $proxy->id,
            'proxy_name' => $proxy->name,
        ]);
    }

    private function publicProxy(EgressProxy $proxy): array
    {
        return [
            'id' => $proxy->id,
            'name' => $proxy->name,
            'protocol' => $proxy->protocol,
            'host' => $proxy->host,
            'port' => (int) $proxy->port,
            'username_configured' => $proxy->username !== null && $proxy->username !== '',
            'password_configured' => $proxy->password !== null && $proxy->password !== '',
            'tls_enabled' => $proxy->tls_enabled,
            'tls_server_name' => $proxy->tls_server_name,
            'allow_insecure' => $proxy->allow_insecure,
            'config' => $proxy->config ?? [],
            'enabled' => $proxy->enabled,
            'servers_count' => $proxy->servers_count ?? $proxy->servers()->count(),
            'health' => $this->healthSummary($proxy),
            'updated_at' => optional($proxy->updated_at)->toIso8601String(),
        ];
    }

    private function healthSummary(EgressProxy $proxy): ?array
    {
        $nodes = $proxy->servers()->pluck('v2_server.id');
        if ($nodes->isEmpty()) {
            return null;
        }
        $health = $nodes
            ->map(fn ($serverId) => Cache::get("egress_health:{$proxy->id}:{$serverId}"))
            ->filter(fn ($item) => is_array($item))
            ->values();
        if ($health->isEmpty()) {
            return null;
        }
        $latest = $health->sortByDesc(fn ($item) => (int) ($item['completed_at'] ?? 0))->first();
        return [
            'tested_nodes' => $health->count(),
            'healthy_nodes' => $health->where('ok', true)->count(),
            'last_ok' => (bool) ($latest['ok'] ?? false),
            'last_message' => (string) ($latest['message'] ?? ''),
            'last_probed_at' => (int) ($latest['completed_at'] ?? 0),
            'last_exit_ip' => (string) ($latest['exit_ip'] ?? ''),
        ];
    }

    private function syncBoundNodes(EgressProxy $proxy): void
    {
        $serverIds = $proxy->servers()->pluck('v2_server.id');
        $this->finishBindingChange($serverIds);
    }

    private function finishBindingChange(iterable $changedIds): void
    {
        $ids = collect($changedIds)->map(fn ($id) => (int) $id)->unique()->values();
        if ($ids->isEmpty()) return;
        ServerService::bumpConfigRevision($ids->all());
        $this->clearAppliedConfig($ids);
        $this->notifyNodeConfigs($ids);
    }

    private function notifyNodeConfigs(iterable $serverIds): void
    {
        foreach ($serverIds as $serverId) {
            NodeSyncService::notifyConfigUpdated((int) $serverId);
        }
    }

    private function clearAppliedConfig(iterable $serverIds): void
    {
        foreach ($serverIds as $serverId) {
            Cache::forget("node_config_applied:" . (int) $serverId);
        }
    }

    private function waitForNodeSync(
        iterable $serverIds,
        int $egressProxyId,
        int $requestedAt,
        float $timeout = 3.0,
        ?bool $expectAvailable = null
    ): array
    {
        $pending = collect($serverIds)->map(fn ($id) => (int) $id)->unique()->values();
        $deadline = microtime(true) + max(0, $timeout);

        do {
            $pending = $pending->reject(function (int $serverId) use (
                $egressProxyId,
                $requestedAt,
                $expectAvailable
            ) {
                $applied = Cache::get("node_config_applied:{$serverId}");
                if (!is_array($applied) || (int) ($applied['applied_at'] ?? 0) < $requestedAt) {
                    return false;
                }
                $availableIds = array_map('intval', $applied['egress_proxy_ids'] ?? []);
                $present = (int) ($applied['egress_proxy_id'] ?? -1) === $egressProxyId
                    || (int) ($applied['final_egress_proxy_id'] ?? -1) === $egressProxyId
                    || in_array($egressProxyId, $availableIds, true);
                return $expectAvailable === null ? $present : $present === $expectAvailable;
            })->values();
            if ($pending->isEmpty()) {
                break;
            }
            if ($timeout <= 0) {
                break;
            }
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
