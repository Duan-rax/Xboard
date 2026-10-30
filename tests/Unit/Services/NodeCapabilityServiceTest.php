<?php

namespace Tests\Unit\Services;

use App\Services\NodeCapabilityService;
use Tests\TestCase;

class NodeCapabilityServiceTest extends TestCase
{
    public function test_preserves_and_sorts_reported_capabilities(): void
    {
        $capabilities = NodeCapabilityService::fromMetrics([
            'kernel' => 'sing-box',
            'kernel_version' => 'v1.14.0-alpha.2',
            'features' => ['rule_set', 'domain_exact', 'rule_set', ' domain_suffix '],
        ]);

        $this->assertTrue($capabilities['known']);
        $this->assertSame('sing-box', $capabilities['kernel']);
        $this->assertSame('v1.14.0-alpha.2', $capabilities['kernel_version']);
        $this->assertSame(['domain_exact', 'domain_suffix', 'rule_set'], $capabilities['features']);
    }

    public function test_treats_legacy_metrics_as_unknown(): void
    {
        $capabilities = NodeCapabilityService::fromMetrics([
            'kernel_status' => true,
        ]);

        $this->assertFalse($capabilities['known']);
        $this->assertSame([], $capabilities['features']);
    }

    public function test_accepts_geo_rules_for_both_kernels(): void
    {
        $criteria = [
            'geoip' => ['cn'],
            'geosite' => ['openai'],
        ];

        foreach (['xray', 'sing-box'] as $kernel) {
            $result = NodeCapabilityService::evaluate($criteria, 'direct', 'all', [
                'known' => true,
                'features' => [
                    'structured_routes',
                    'match_all',
                    'geoip',
                    'geosite',
                ],
            ]);
            $this->assertTrue($result['supported'], $kernel);
        }
    }

    public function test_rejects_rule_set_on_xray_and_reports_missing_feature(): void
    {
        $result = NodeCapabilityService::evaluate(
            ['rule_sets' => ['cn_ip']],
            'direct',
            'any',
            [
                'known' => true,
                'features' => [
                    'structured_routes',
                    'match_any',
                    'rule_set',
                ],
            ]
        );

        $this->assertTrue($result['supported']);

        $xray = NodeCapabilityService::evaluate(
            ['rule_sets' => ['cn_ip']],
            'direct',
            'any',
            [
                'known' => true,
                'features' => [
                    'structured_routes',
                    'match_any',
                ],
            ]
        );
        $this->assertFalse($xray['supported']);
        $this->assertSame(['rule_set'], $xray['missing_features']);
    }

    public function test_unknown_capabilities_do_not_block_legacy_nodes(): void
    {
        $result = NodeCapabilityService::evaluate(
            ['domains' => ['example.com']],
            'direct',
            'any',
            ['known' => false, 'features' => []]
        );

        $this->assertNull($result['supported']);
        $this->assertFalse($result['known']);
    }
}
