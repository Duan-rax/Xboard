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
        $this->assertSame(['1.1.1.1/24', '2001:db8::/32'], $criteria['ip_cidrs']);
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
}
