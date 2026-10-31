<?php

namespace Tests\Unit\Services;

use App\Services\GeoIpMatcher;
use PHPUnit\Framework\TestCase;

class GeoIpMatcherTest extends TestCase
{
    public function test_matches_cn_and_not_cn_with_injected_country_lookup(): void
    {
        $matcher = new GeoIpMatcher(fn (string $ip) => $ip === '203.0.113.8' ? '美国' : 'cn');

        $this->assertTrue($matcher->matchesAny(['!cn'], '203.0.113.8'));
        $this->assertFalse($matcher->matchesAny(['cn'], '203.0.113.8'));
        $this->assertTrue($matcher->matchesAny(['cn'], '198.51.100.8'));
    }

    public function test_private_ranges_are_not_treated_as_public_not_cn(): void
    {
        $matcher = new GeoIpMatcher();

        $this->assertTrue($matcher->matchesAny(['private'], '10.0.0.1'));
        $this->assertFalse($matcher->matchesAny(['!cn'], '10.0.0.1'));
    }

    public function test_unknown_country_code_stays_indeterminate(): void
    {
        $matcher = new GeoIpMatcher(fn () => null);

        $this->assertNull($matcher->matchesAny(['us'], '203.0.113.8'));
    }
}
