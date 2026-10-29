<?php

namespace Tests\Unit\Services;

use App\Models\EgressProxy;
use App\Models\Server;
use App\Services\ServerService;
use PHPUnit\Framework\TestCase;

class EgressProxyConfigTest extends TestCase
{
    public function test_enabled_egress_profile_is_only_in_node_control_config(): void
    {
        $proxy = new EgressProxy();
        $proxy->forceFill([
            'id' => 42,
            'name' => 'Residential SOCKS',
            'protocol' => 'socks5',
            'host' => '198.51.100.10',
            'port' => 1080,
            'enabled' => true,
            'config' => [],
        ]);

        $server = new Server();
        $server->forceFill([
            'type' => Server::TYPE_HTTP,
            'host' => 'entry.example.test',
            'port' => 443,
            'server_port' => 443,
            'protocol_settings' => [],
            'egress_proxy_id' => 42,
        ]);
        $server->setRelation('egressProxy', $proxy);

        $config = ServerService::buildNodeConfig($server);

        $this->assertSame('socks5', $config['egress_proxy']['protocol']);
        $this->assertSame('198.51.100.10', $config['egress_proxy']['host']);
        $this->assertSame(1080, $config['egress_proxy']['port']);
    }

    public function test_disabled_egress_profile_is_not_sent_to_node(): void
    {
        $proxy = new EgressProxy();
        $proxy->forceFill([
            'id' => 42,
            'name' => 'Disabled proxy',
            'protocol' => 'socks5',
            'host' => '198.51.100.10',
            'port' => 1080,
            'enabled' => false,
            'config' => [],
        ]);

        $server = new Server();
        $server->forceFill([
            'type' => Server::TYPE_HTTP,
            'host' => 'entry.example.test',
            'port' => 443,
            'server_port' => 443,
            'protocol_settings' => [],
            'egress_proxy_id' => 42,
        ]);
        $server->setRelation('egressProxy', $proxy);

        $this->assertArrayNotHasKey('egress_proxy', ServerService::buildNodeConfig($server));
    }
}
