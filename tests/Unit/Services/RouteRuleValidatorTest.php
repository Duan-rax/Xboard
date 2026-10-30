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
            'domain_keywords' => [' Tracker '],
            'domain_regexes' => ['(^|\\.)example[0-9]+\\.com$'],
            'ip_cidrs' => ['1.1.1.1/24', '2001:db8::/32'],
            'ports' => ['443', '8000:8010'],
            'networks' => ['TCP'],
            'source_cidrs' => ['10.0.0.0/8'],
            'source_ports' => ['1000-2000'],
            'protocols' => ['BITTORRENT', 'TLS'],
            'geoip' => ['geoip:CN', 'cn_ip'],
            'geosite' => ['geosite:CN', 'category-ads-all'],
            'rule_sets' => ['cn_ip'],
        ]);

        $this->assertSame(['api.example.com'], $criteria['domains']);
        $this->assertSame(['openai.com'], $criteria['domain_suffixes']);
        $this->assertSame(['tracker'], $criteria['domain_keywords']);
        $this->assertSame(['(^|\\.)example[0-9]+\\.com$'], $criteria['domain_regexes']);
        $this->assertSame(['1.1.1.0/24', '2001:db8::/32'], $criteria['ip_cidrs']);
        $this->assertSame(['443', '8000-8010'], $criteria['ports']);
        $this->assertSame(['tcp'], $criteria['networks']);
        $this->assertSame(['bittorrent', 'tls'], $criteria['protocols']);
        $this->assertSame(['cn'], $criteria['geoip']);
        $this->assertSame(['cn', 'category-ads-all'], $criteria['geosite']);
        $this->assertSame(['cn_ip'], $criteria['rule_sets']);
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

    public function test_rejects_unsafe_rule_set_tag(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'rule_sets' => ['../../config.json'],
        ]);
    }

    public function test_rejects_unknown_sniff_protocol(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'protocols' => ['thunder'],
        ]);
    }

    public function test_rejects_non_re2_domain_regex(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'domain_regexes' => ['(?>example)'],
        ]);
    }

    public function test_rejects_possessive_domain_regex_quantifier(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'domain_regexes' => ['example++'],
        ]);
    }

    public function test_rejects_nested_criteria_values(): void
    {
        $this->expectException(ValidationException::class);
        RouteRuleValidator::normalizeCriteria([
            'domains' => [['example.com']],
        ]);
    }
}
