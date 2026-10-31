<?php

namespace Tests\Unit\Services;

use App\Services\RoutePresetService;
use PHPUnit\Framework\TestCase;

class RoutePresetServiceTest extends TestCase
{
    public function test_builtin_ai_collection_replaces_manual_vendor_list(): void
    {
        $this->assertSame(['category-ai-!cn'], RoutePresetService::AI_GEOSITES);
        $this->assertNotContains('category-ai-cn', RoutePresetService::AI_GEOSITES);
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

    public function test_bittorrent_preset_uses_private_and_public_collections(): void
    {
        $this->assertContains('category-pt', RoutePresetService::BIT_TORRENT_GEOSITES);
        $this->assertContains('category-public-tracker', RoutePresetService::BIT_TORRENT_GEOSITES);
        $this->assertContains('tracker', RoutePresetService::BIT_TORRENT_GEOSITES);
        $this->assertContains('bittorrent.com', RoutePresetService::BIT_TORRENT_MANUAL_COVERED);
        $this->assertContains('openbittorrent.com', RoutePresetService::BIT_TORRENT_MANUAL_COVERED);
    }
}
