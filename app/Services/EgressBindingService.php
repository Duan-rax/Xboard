<?php

namespace App\Services;

use App\Models\EgressProxy;
use App\Models\Server;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class EgressBindingService
{
    public function setAvailability(
        EgressProxy $proxy,
        iterable $serverIds,
        bool $available,
        bool $makeDefault = false,
        bool $clearDefault = false
    ): Collection {
        $ids = collect($serverIds)->map(fn ($id) => (int) $id)->filter()->unique()->values();
        if ($ids->isEmpty()) return collect();
        if (!$proxy->enabled && $available) {
            throw ValidationException::withMessages([
                'egress_proxy_id' => ['出站资料未启用，不能授权到节点。'],
            ]);
        }

        $servers = Server::query()->whereIn('id', $ids)->lockForUpdate()->get();
        if ($servers->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'server_ids' => ['存在已被删除的节点，请刷新后重试。'],
            ]);
        }

        $changed = collect();
        foreach ($servers as $server) {
            $existing = DB::table('v2_server_egress_binding')
                ->where('server_id', $server->id)
                ->where('egress_proxy_id', $proxy->id)
                ->first();
            $isDefault = (int) $server->egress_proxy_id === (int) $proxy->id;
            $before = [
                'available' => $existing !== null,
                'default' => $isDefault,
            ];

            if ($available) {
                DB::table('v2_server_egress_binding')->updateOrInsert(
                    ['server_id' => $server->id, 'egress_proxy_id' => $proxy->id],
                    [
                        'is_default' => $makeDefault,
                        'updated_at' => now(),
                        'created_at' => $existing?->created_at ?? now(),
                    ]
                );
                if ($makeDefault) {
                    $this->setDefault($server, $proxy);
                } elseif ($clearDefault && $before['default']) {
                    $this->clearDefault($server, $proxy);
                }
            } else {
                DB::table('v2_server_egress_binding')
                    ->where('server_id', $server->id)
                    ->where('egress_proxy_id', $proxy->id)
                    ->delete();
                if ($before['default']) {
                    $this->clearDefault($server, $proxy);
                }
            }

            $server->refresh();
            $after = [
                'available' => DB::table('v2_server_egress_binding')
                    ->where('server_id', $server->id)
                    ->where('egress_proxy_id', $proxy->id)
                    ->exists(),
                'default' => (int) $server->egress_proxy_id === (int) $proxy->id,
            ];
            if ($before !== $after) {
                $changed->push((int) $server->id);
            }
        }
        return $changed;
    }

    public function ensureAvailability(EgressProxy $proxy, iterable $serverIds): Collection
    {
        return $this->setAvailability($proxy, $serverIds, true, false);
    }

    public function availableProxyIds(int $serverId): array
    {
        return DB::table('v2_server_egress_binding')
            ->where('server_id', $serverId)
            ->pluck('egress_proxy_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    public function availableForServer(int $serverId): Collection
    {
        return EgressProxy::query()
            ->join('v2_server_egress_binding as binding', 'binding.egress_proxy_id', '=', 'v2_egress_proxy.id')
            ->where('binding.server_id', $serverId)
            ->where('v2_egress_proxy.enabled', true)
            ->orderBy('v2_egress_proxy.name')
            ->get(['v2_egress_proxy.*', 'binding.is_default'])
            ->each(fn (EgressProxy $proxy) => $proxy->setAttribute(
                'is_default',
                (bool) $proxy->getAttribute('is_default')
            ));
    }

    private function setDefault(Server $server, EgressProxy $proxy): void
    {
        DB::table('v2_server_egress_binding')
            ->where('server_id', $server->id)
            ->update(['is_default' => false, 'updated_at' => now()]);
        DB::table('v2_server_egress_binding')
            ->where('server_id', $server->id)
            ->where('egress_proxy_id', $proxy->id)
            ->update(['is_default' => true, 'updated_at' => now()]);
        $server->egress_proxy_id = $proxy->id;
        $server->save();
    }

    private function clearDefault(Server $server, EgressProxy $proxy): void
    {
        DB::table('v2_server_egress_binding')
            ->where('server_id', $server->id)
            ->where('egress_proxy_id', $proxy->id)
            ->update(['is_default' => false, 'updated_at' => now()]);
        $server->egress_proxy_id = null;
        $server->save();
    }
}
