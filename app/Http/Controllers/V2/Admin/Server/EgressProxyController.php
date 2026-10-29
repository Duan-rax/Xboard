<?php

namespace App\Http\Controllers\V2\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\EgressProxy;
use App\Models\Server;
use App\Services\NodeSyncService;
use Illuminate\Http\Request;

class EgressProxyController extends Controller
{
    public function fetch()
    {
        return $this->success(EgressProxy::query()
            ->withCount('servers')
            ->orderByDesc('id')
            ->get()
            ->map(fn (EgressProxy $proxy) => $this->publicProxy($proxy)));
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
            'enabled' => 'nullable|boolean',
        ]);

        $proxy = isset($params['id']) ? EgressProxy::findOrFail($params['id']) : new EgressProxy();
        unset($params['id']);
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
