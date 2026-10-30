<?php

namespace Tests\Unit\Services;

use App\Services\RouteRuleValidator;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class RouteRuleValidatorTest extends TestCase
{
    public function test_normalizes_structured_criteria(): void
    {
        $criteria = RouteRuleValidator::normalizeCriteria([
            'domains' => [' API.Example.com ', 'api.example.com'],
            'domain_suffixes' => ['*.OpenAI.com'],
            'ip_cidrs' => ['1.1.1.1/24', '2001:db8::/32'],
            'ports' => ['443', '8000:8010'],
            'networks' => ['TCP'],
            'source_cidrs' => ['10.0.0.0/8'],
            'source_ports' => ['1000-2000'],
        ]);

        $this->assertSame(['api.example.com'], $criteria['domains']);
        $this->assertSame(['openai.com'], $criteria['domain_suffixes']);
        $this->assertSame(['1.1.1.0/24', '2001:db8::/32'], $criteria['ip_cidrs']);
        $this->assertSame(['443', '8000-8010'], $criteria['ports']);
        $this->assertSame(['tcp'], $criteria['networks']);
        $this->assertTrue(RouteRuleValidator::hasCriteria($criteria));
    }

    public function test_converts_legacy_match_values(): void
    {
        $criteria = RouteRuleValidator::criteriaFromLegacyMatch([
            '*.example.com',
            '10.0.0.0/8',
            '2001:db8::/32',
        ]);

        $this->assertSame(['example.com'], $criteria['domain_suffixes']);
        $this->assertSame(['10.0.0.0/8', '2001:db8::/32'], $criteria['ip_cidrs']);
    }

    public function test_rejects_invalid_cidr_and_port_range(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'ip_cidrs' => ['999.1.1.1/99'],
        ]);
    }

    public function test_rejects_proxy_without_target(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::assertUsable(
            RouteRuleValidator::normalizeCriteria(['domains' => ['example.com']]),
            [],
            'proxy',
            null
        );
    }

    public function test_normalizes_host_bits_and_idn_domains(): void
    {
        $criteria = RouteRuleValidator::normalizeCriteria([
            'domains' => ['例子.测试'],
            'ip_cidrs' => ['10.1.2.3/8', '2001:db8:1234::1/48'],
        ]);

        if (function_exists('idn_to_ascii')) {
            $this->assertSame(['xn--fsqu00a.xn--0zwm56d'], $criteria['domains']);
        }
        $this->assertSame(['10.0.0.0/8', '2001:db8:1234::/48'], $criteria['ip_cidrs']);
    }

    public function test_counts_expanded_rules_for_any_and_all(): void
    {
        $criteria = RouteRuleValidator::normalizeCriteria([
            'domains' => ['example.com'],
            'ports' => ['443'],
            'networks' => ['tcp'],
        ]);

        $this->assertSame(3, RouteRuleValidator::expandedRuleCount($criteria, 'any'));
        $this->assertSame(1, RouteRuleValidator::expandedRuleCount($criteria, 'all'));
    }
}
