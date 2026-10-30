<?php

namespace App\Observers;

use App\Models\Server;
use App\Services\NodeSyncService;
use App\Services\ServerService;

class ServerObserver
{
    public bool $afterCommit = true;

    public function created(Server $server): void
    {
        $this->notifyMachineNodesChanged($server->machine_id);
    }

    public function updated(Server $server): void
    {
        $configChanged = $server->wasChanged([
            'server_port',
            'protocol_settings',
            'type',
            'route_ids',
            'custom_outbounds',
            'custom_routes',
            'cert_config',
            'egress_proxy_id',
        ]);
        if ($configChanged && !$server->wasChanged('config_revision')) {
            ServerService::bumpConfigRevision([$server->id]);
            $server->config_revision = ((int) $server->config_revision) + 1;
        }

        if ($server->wasChanged('group_ids')) {
            NodeSyncService::notifyFullSync($server->id);
        } elseif ($configChanged) {
            NodeSyncService::notifyConfigUpdated($server->id);
        }

        if ($server->wasChanged(['machine_id', 'enabled'])) {
            $this->notifyMachineChange(
                $server->machine_id,
                $server->getOriginal('machine_id')
            );
        }
    }

    public function deleted(Server $server): void
    {
        $this->notifyMachineChange(null, $server->getOriginal('machine_id') ?: $server->machine_id);
    }

    private function notifyMachineChange(?int $newMachineId, ?int $oldMachineId): void
    {
        $notified = [];

        if ($newMachineId) {
            NodeSyncService::notifyMachineNodesChanged($newMachineId);
            $notified[] = $newMachineId;
        }

        if ($oldMachineId && !in_array($oldMachineId, $notified, true)) {
            NodeSyncService::notifyMachineNodesChanged($oldMachineId);
        }
    }

    private function notifyMachineNodesChanged(?int $machineId): void
    {
        if ($machineId) {
            NodeSyncService::notifyMachineNodesChanged($machineId);
        }
    }
}
