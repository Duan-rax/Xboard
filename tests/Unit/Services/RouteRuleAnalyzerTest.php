<?php

namespace Tests\Unit\Services;

use App\Services\RouteRuleAnalyzer;
use Tests\TestCase;

class RouteRuleAnalyzerTest extends TestCase
{
    public function test_detects_duplicate_rule_after_canonicalizing_value_order(): void
    {
        $result = RouteRuleAnalyzer::analyze([
            $this->route(1, ['domains' => ['a.example', 'b.example']], 'direct', 10),
            $this->route(2, ['domains' => ['b.example', 'a.example']], 'direct', 20),
        ], [1 => [10], 2 => [10]]);

        $this->assertSame('duplicate_rule', $this->diagnostic($result[2], 'duplicate_rule')['code']);
        $this->assertSame(1, $this->diagnostic($result[2], 'duplicate_rule')['related_route_id']);
    }

    public function test_detects_shadowed_rule_with_different_action(): void
    {
        $result = RouteRuleAnalyzer::analyze([
            $this->route(1, ['domain_suffixes' => ['example.com']], 'block', 10),
            $this->route(2, ['domain_suffixes' => ['example.com']], 'direct', 20),
        ], [1 => [10], 2 => [10]]);

        $diagnostic = $this->diagnostic($result[2], 'shadowed_rule');
        $this->assertSame('error', $diagnostic['severity']);
        $this->assertSame(1, $diagnostic['related_route_id']);
    }

    public function test_disabled_rule_does_not_shadow_later_rule(): void
    {
        $first = $this->route(1, ['domains' => ['example.com']], 'block', 10);
        $first['enabled'] = false;

        $result = RouteRuleAnalyzer::analyze([
            $first,
            $this->route(2, ['domains' => ['example.com']], 'direct', 20),
        ], [2 => [10]]);

        $this->assertNull($this->diagnostic($result[2], 'shadowed_rule'));
        $this->assertNull($this->diagnostic($result[2], 'duplicate_rule'));
    }

    public function test_match_mode_is_part_of_the_match_signature(): void
    {
        $any = $this->route(1, ['domains' => ['example.com'], 'ports' => ['443']], 'direct', 10);
        $all = $this->route(2, ['domains' => ['example.com'], 'ports' => ['443']], 'direct', 20);
        $all['match_mode'] = 'all';

        $result = RouteRuleAnalyzer::analyze([$any, $all], [1 => [10], 2 => [10]]);

        $this->assertNull($this->diagnostic($result[2], 'duplicate_rule'));
    }

    public function test_reports_unbound_enabled_rule(): void
    {
        $result = RouteRuleAnalyzer::analyze([
            $this->route(7, ['geoip' => ['cn']], 'direct', 10),
        ]);

        $this->assertSame('info', $this->diagnostic($result[7], 'unbound_rule')['severity']);
    }

    public function test_reports_proxy_target_missing_from_some_bound_nodes(): void
    {
        $route = $this->route(5, ['domains' => ['example.com']], 'proxy', 10);
        $route['action_value'] = 'ss-out';

        $result = RouteRuleAnalyzer::analyze(
            [$route],
            [5 => [10, 11]],
            [10 => ['ss-out'], 11 => ['direct']]
        );

        $diagnostic = $this->diagnostic($result[5], 'missing_proxy_target');
        $this->assertSame([11], $diagnostic['server_ids']);
        $this->assertSame('warning', $diagnostic['severity']);
    }

    private function route(int $id, array $criteria, string $action, int $priority): array
    {
        return [
            'id' => $id,
            'criteria' => $criteria,
            'match' => [],
            'match_mode' => 'any',
            'priority' => $priority,
            'enabled' => true,
            'action' => $action,
            'action_value' => null,
        ];
    }

    private function diagnostic(array $diagnostics, string $code): ?array
    {
        foreach ($diagnostics as $diagnostic) {
            if (($diagnostic['code'] ?? null) === $code) {
                return $diagnostic;
            }
        }
        return null;
    }
}
