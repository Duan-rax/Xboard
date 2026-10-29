<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\EgressProxy;
use App\Models\Server;
use App\Services\NodeSyncService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class EgressProxyController extends Controller
{
    public function fetch(Request $request)
    {
        $params = $request->validate([
            'page' => 'nullable|integer|min:1',
            'page_size' => 'nullable|integer|between:1,100',
            'search' => 'nullable|string|max:128',
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

    public function save(Request $request)
    {
        $params = $request->validate([
            'id' => 'nullable|integer',
            'name' => 'required|string|max:128',
            'protocol' => 'required|in:socks5,http,shadowsocks,vless,trojan',
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
            'config.reality' => 'nullable|array',
            'config.reality.public_key' => 'nullable|string|max:255',
            'config.reality.short_id' => 'nullable|string|max:64',
            'enabled' => 'nullable|boolean',
            'clear_username' => 'nullable|boolean',
            'clear_password' => 'nullable|boolean',
        ]);

        $proxy = isset($params['id']) ? EgressProxy::findOrFail($params['id']) : new EgressProxy();
        unset($params['id']);

        $clearUsername = (bool) ($params['clear_username'] ?? false);
        $clearPassword = (bool) ($params['clear_password'] ?? false);
        unset($params['clear_username'], $params['clear_password']);
        if ($clearUsername) {
            $params['username'] = null;
        }
        if ($clearPassword) {
            $params['password'] = null;
        }

        $config = $params['config'] ?? $proxy->config ?? [];
        $effectivePassword = array_key_exists('password', $params)
            ? $params['password']
            : $proxy->password;
        $errors = [];
        if ($params['protocol'] === 'shadowsocks') {
            if (trim((string) ($config['method'] ?? '')) === '') {
                $errors['config.method'] = ['Shadowsocks 出站必须填写 config.method。'];
            }
            if (trim((string) $effectivePassword) === '') {
                $errors['password'] = ['Shadowsocks 出站必须填写密码。'];
            }
        }
        if ($params['protocol'] === 'vless' && trim((string) ($config['uuid'] ?? '')) === '') {
            $errors['config.uuid'] = ['VLESS 出站必须填写 config.uuid。'];
        }
        if ($params['protocol'] === 'trojan' && trim((string) $effectivePassword) === '') {
            $errors['password'] = ['Trojan 出站必须填写密码。'];
        }
        if (isset($config['reality'])) {
            if (trim((string) ($config['reality']['public_key'] ?? '')) === '') {
                $errors['config.reality.public_key'] = ['Reality 出站必须填写 public_key。'];
            }
            if (trim((string) ($config['reality']['short_id'] ?? '')) === '') {
                $errors['config.reality.short_id'] = ['Reality 出站必须填写 short_id。'];
            }
        }
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
        if ($proxy->servers()->exists()) {
            return $this->fail([400, '该出站代理仍绑定节点；请先解绑节点后再删除。']);
        }
        $proxy->delete();
        return $this->success(true);
    }

    /** Assign or clear an egress profile without exposing its credentials. */
    public function bind(Request $request)
    {
        $params = $request->validate([
            'server_id' => 'required|integer',
            // A zero value is the UI's explicit "unbind" value. It is
            // converted to null below rather than being a phantom profile.
            'egress_proxy_id' => 'nullable|integer',
        ]);
        $egressProxyId = (int) ($params['egress_proxy_id'] ?? 0);
        if ($egressProxyId > 0) {
            EgressProxy::findOrFail($egressProxyId);
        }
        $server = Server::findOrFail($params['server_id']);
        $server->egress_proxy_id = $egressProxyId ?: null;
        $server->save();
        return $this->success(true);
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
            'servers_count' => $proxy->servers_count ?? 0,
        ];
    }

    private function syncBoundNodes(EgressProxy $proxy): void
    {
        Server::query()->where('egress_proxy_id', $proxy->id)->pluck('id')->each(
            fn (int $serverId) => NodeSyncService::notifyConfigUpdated($serverId)
        );
    }
}

