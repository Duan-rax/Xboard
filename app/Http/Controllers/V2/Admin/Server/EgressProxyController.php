<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\EgressProxy;
use App\Models\Server;
use App\Services\EgressProxyValidator;
use App\Services\NodeSyncService;
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
        ]);
        $pageSize = (int) ($params['page_size'] ?? 50);
        $search = trim((string) ($params['search'] ?? ''));
        $bound = $params['bound'] ?? 'all';

        $paginator = Server::query()
            ->select(['id', 'name', 'host', 'port', 'type', 'enabled', 'machine_id', 'egress_proxy_id'])
            ->with(['egressProxy' => fn ($query) => $query->select(['id', 'name'])])
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('host', 'like', "%{$search}%");
                });
            })
            ->when($bound === 'bound', fn ($query) => $query->whereNotNull('egress_proxy_id'))
            ->when($bound === 'unbound', fn ($query) => $query->whereNull('egress_proxy_id'))
            ->when(
                !empty($params['egress_proxy_id']),
                fn ($query) => $query->where('egress_proxy_id', (int) $params['egress_proxy_id'])
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
    public function bind(Request $request)
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
        if ($egressProxyId > 0) {
            EgressProxy::findOrFail($egressProxyId);
        }

        $servers = Server::query()->whereIn('id', $ids)->get();
        if ($servers->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'server_ids' => ['存在已被删除的节点，请刷新后重试。'],
            ]);
        }

        $changedIds = $servers
            ->filter(fn (Server $server) => (int) $server->egress_proxy_id !== $egressProxyId)
            ->pluck('id')
            ->values();

        DB::transaction(function () use ($changedIds, $egressProxyId) {
            if ($changedIds->isNotEmpty()) {
                Server::query()
                    ->whereIn('id', $changedIds)
                    ->update(['egress_proxy_id' => $egressProxyId ?: null]);
            }
        });
        $requestedAt = time();
        $this->notifyNodeConfigs($changedIds);

        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => $ids,
            'egress_proxy_id' => $egressProxyId ?: null,
            'requested_at' => $requestedAt,
            'sync' => $this->waitForNodeSync($changedIds, $egressProxyId, $requestedAt),
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
        ]);

        return $this->success([
            'sync' => $this->waitForNodeSync(
                $params['server_ids'],
                (int) $params['egress_proxy_id'],
                (int) $params['requested_at'],
                0
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

        $changedIds = Server::query()
            ->where('egress_proxy_id', $egressProxyId)
            ->pluck('id');
        DB::transaction(function () use ($changedIds) {
            if ($changedIds->isNotEmpty()) {
                Server::query()
                    ->whereIn('id', $changedIds)
                    ->update(['egress_proxy_id' => null]);
            }
        });
        $requestedAt = time();
        $this->notifyNodeConfigs($changedIds);

        return $this->success([
            'changed' => $changedIds->count(),
            'server_ids' => $changedIds,
            'egress_proxy_id' => null,
            'requested_at' => $requestedAt,
            'sync' => $this->waitForNodeSync($changedIds, 0, $requestedAt),
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
            'updated_at' => optional($proxy->updated_at)->toIso8601String(),
        ];
    }

    private function syncBoundNodes(EgressProxy $proxy): void
    {
        $this->notifyNodeConfigs(
            Server::query()->where('egress_proxy_id', $proxy->id)->pluck('id')
        );
    }

    private function notifyNodeConfigs(iterable $serverIds): void
    {
        foreach ($serverIds as $serverId) {
            NodeSyncService::notifyConfigUpdated((int) $serverId);
        }
    }

    private function waitForNodeSync(
        iterable $serverIds,
        int $egressProxyId,
        int $requestedAt,
        float $timeout = 3.0
    ): array
    {
        $pending = collect($serverIds)->map(fn ($id) => (int) $id)->unique()->values();
        $deadline = microtime(true) + max(0, $timeout);

        do {
            $pending = $pending->reject(function (int $serverId) use ($egressProxyId, $requestedAt) {
                $applied = Cache::get("node_config_applied:{$serverId}");
                return is_array($applied)
                    && (int) ($applied['egress_proxy_id'] ?? -1) === $egressProxyId
                    && (int) ($applied['applied_at'] ?? 0) >= $requestedAt;
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
