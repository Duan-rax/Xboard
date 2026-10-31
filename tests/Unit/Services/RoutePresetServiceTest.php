<?php

namespace Tests\Unit\Services;

use App\Services\RoutePresetService;
use PHPUnit\Framework\TestCase;

class RoutePresetServiceTest extends TestCase
{
    public function test_builtin_ai_suffixes_cover_major_providers(): void
    {
        $this->assertContains('openai.com', RoutePresetService::AI_DOMAIN_SUFFIXES);
        $this->assertContains('anthropic.com', RoutePresetService::AI_DOMAIN_SUFFIXES);
        $this->assertContains('gemini.google.com', RoutePresetService::AI_DOMAIN_SUFFIXES);
        $this->assertContains('perplexity.ai', RoutePresetService::AI_DOMAIN_SUFFIXES);
    }

    public function test_definitions_are_stable_and_cover_three_categories(): void
    {
        $definitions = RoutePresetService::definitions();
        $this->assertSame(
            [RoutePresetService::ADS_KEY, RoutePresetService::BT_KEY, RoutePresetService::AI_KEY],
            array_column($definitions, 'key')
        );
        $this->assertSame('proxy', $definitions[2]['action']);
    }
}
