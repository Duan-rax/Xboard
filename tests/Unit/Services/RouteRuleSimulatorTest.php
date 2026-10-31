<?php

namespace Tests\Unit\Services;

use App\Services\RouteRuleSimulator;
use PHPUnit\Framework\TestCase;

class RouteRuleSimulatorTest extends TestCase
{
    public function testMatchesDomainSuffixAndPortWithPriorityOrder(): void
    {
        $routes = [
            $this->route(2, 20, [
                'domain_suffixes' => ['example.com'],
                'ports' => ['443'],
            ], 'proxy', 'warp'),
            $this->route(1, 10, [
                'domain_suffixes' => ['api.example.com'],
            ], 'block'),
        ];

        $result = RouteRuleSimulator::simulate($routes, ['egress_proxy_id' => 0], [
            'destination' => 'api.example.com',
            'domain' => 'api.example.com',
            'destination_ip' => '',
            'port' => 443,
            'network' => 'tcp',
        ]);

        $this->assertSame(1, $result['matched_rule']['route_id']);
        $this->assertSame('block', $result['final_action']);
        $this->assertSame(2, $result['shadowed_rules'][0]['route_id']);
    }

    public function testAllModeRequiresKnownDomainAndCidrMatches(): void
    {
        $routes = [
            $this->route(3, 10, [
                'domain_suffixes' => ['openai.com'],
                'ip_cidrs' => ['104.18.0.0/16'],
            ], 'proxy', 'us-residential', 'all'),
        ];

        $result = RouteRuleSimulator::simulate($routes, [], [
            'destination' => 'api.openai.com',
            'domain' => 'api.openai.com',
            'destination_ip' => '104.18.12.1',
            'port' => 443,
            'network' => 'tcp',
        ]);

        $this->assertSame('match', $result['matched_rule']['status']);
        $this->assertSame('us-residential', $result['final_outbound']);
        $this->assertSame('us-residential', $result['matched_rule']['target']);
    }

    public function testGeoCriteriaAreReportedAsIndeterminate(): void
    {
        $routes = [
            $this->route(4, 10, ['geosite' => ['openai']], 'proxy', 'residential'),
        ];

        $result = RouteRuleSimulator::simulate($routes, [], [
            'destination' => 'api.openai.com',
            'domain' => 'api.openai.com',
            'destination_ip' => '',
            'port' => 443,
        ]);

        $this->assertNull($result['matched_rule']);
        $this->assertSame(4, $result['possible_rule']['route_id']);
        $this->assertContains('geosite', $result['possible_rule']['indeterminate_criteria']);
        $this->assertNull($result['final_action']);
        $this->assertNull($result['final_outbound']);
    }

    public function testResolvedCollectionMissesDoNotInferAnActionFromEarlierRules(): void
    {
        $routes = [
            $this->route(38, 5, ['geosite' => ['category-ads-all']], 'block'),
            $this->route(34, 10, ['geoip' => ['cn']], 'block'),
        ];

        $result = RouteRuleSimulator::simulate($routes, [], [
            'destination' => 'atcc.org',
            'domain' => 'atcc.org',
            'destination_ip' => '203.0.113.8',
            'port' => 443,
        ], [
            'geosite' => fn (array $tags, string $domain) => false,
            'geoip' => fn (array $codes, string $ip) => false,
        ]);

        $this->assertNull($result['matched_rule']);
        $this->assertNull($result['possible_rule']);
        $this->assertSame('direct', $result['final_action']);
        $this->assertSame('direct', $result['final_outbound']);
    }

    public function testResolvedCollectionMatchProducesDeterministicAction(): void
    {
        $routes = [
            $this->route(40, 60, ['geosite' => ['category-ai-!cn']], 'proxy', 'panel-egress-1'),
        ];

        $result = RouteRuleSimulator::simulate($routes, [
            'available_egress_ids' => [1],
        ], [
            'destination' => 'api.openai.com',
            'domain' => 'api.openai.com',
            'port' => 443,
        ], [
            'geosite' => fn (array $tags, string $domain) => true,
        ]);

        $this->assertSame(40, $result['matched_rule']['route_id']);
        $this->assertSame('proxy', $result['final_action']);
        $this->assertSame('panel-egress-1', $result['final_outbound']);
    }

    public function testUsesBoundEgressAsDefaultWhenNoRuleMatches(): void
    {
        $result = RouteRuleSimulator::simulate([], [
            'egress_proxy_id' => 9,
            'egress_proxy_enabled' => true,
        ], [
            'destination' => 'example.net',
            'domain' => 'example.net',
            'destination_ip' => '',
            'port' => 443,
        ]);

        $this->assertNull($result['matched_rule']);
        $this->assertSame('panel-egress-9', $result['final_outbound']);
    }

    public function testManagedEgressRouteFailsClosedWhenUnavailable(): void
    {
        $routes = [
            $this->route(5, 60, ['domain_suffixes' => ['openai.com']], 'proxy', 'panel-egress-2'),
        ];
        $target = [
            'destination' => 'api.openai.com',
            'domain' => 'api.openai.com',
            'destination_ip' => '',
            'port' => 443,
        ];
        $blocked = RouteRuleSimulator::simulate($routes, [
            'available_egress_ids' => [],
        ], $target);
        $this->assertSame('block', $blocked['final_action']);
        $this->assertContains(
            '目标管理出站尚未授权到该节点；运行时会 fail-closed，将规则转换为阻断。',
            $blocked['warnings']
        );

        $allowed = RouteRuleSimulator::simulate($routes, [
            'available_egress_ids' => [2],
        ], $target);
        $this->assertSame('proxy', $allowed['final_action']);
        $this->assertSame('panel-egress-2', $allowed['final_outbound']);
    }

    private function route(
        int $id,
        int $priority,
        array $criteria,
        string $action,
        string $target = '',
        string $mode = 'any'
    ): array {
        return [
            'id' => $id,
            'remarks' => "route-{$id}",
            'priority' => $priority,
            'enabled' => true,
            'match_mode' => $mode,
            'criteria' => $criteria,
            'match' => [],
            'action' => $action,
            'action_value' => $target,
        ];
    }
}
