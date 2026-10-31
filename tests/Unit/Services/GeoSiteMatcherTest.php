<?php

namespace Tests\Unit\Services;

use App\Services\GeoSiteMatcher;
use PHPUnit\Framework\TestCase;

class GeoSiteMatcherTest extends TestCase
{
    public function test_matches_exact_suffix_keyword_and_regex_rules(): void
    {
        $matcher = $this->matcher([
            'sample' => implode("\n", [
                'exact.example',
                '+.suffix.example',
                'keyword:tracker',
                'regexp:(^|\\.)regex[0-9]+\\.example$',
            ]),
        ]);

        $this->assertTrue($matcher->matchesAny('exact.example', ['sample']));
        $this->assertTrue($matcher->matchesAny('api.suffix.example', ['sample']));
        $this->assertTrue($matcher->matchesAny('cdn-tracker.example', ['sample']));
        $this->assertTrue($matcher->matchesAny('cdn.regex12.example', ['sample']));
        $this->assertFalse($matcher->matchesAny('atcc.org', ['sample']));
    }

    public function test_collection_union_and_unknown_fallback(): void
    {
        $matcher = $this->matcher([
            'ads' => '+.ads.example',
            'ai' => '+.ai.example',
        ]);

        $this->assertFalse($matcher->matchesAny('atcc.org', ['ads', 'ai']));
        $this->assertTrue($matcher->matchesAny('chat.ai.example', ['ads', 'ai']));
        $this->assertNull($matcher->matchesAny('chat.ai.example', ['ads', 'missing']));
    }

    public function test_parses_meta_and_v2fly_list_prefixes(): void
    {
        $patterns = GeoSiteMatcher::parseList(implode("\n", [
            'full:exact.example',
            'domain:suffix.example',
            '+.meta.example',
            'keyword:word',
            'regex:^regex\\.example$',
        ]));

        $this->assertContains('exact.example', $patterns['domains']);
        $this->assertContains('suffix.example', $patterns['suffixes']);
        $this->assertContains('meta.example', $patterns['suffixes']);
        $this->assertContains('word', $patterns['keywords']);
        $this->assertContains('^regex\\.example$', $patterns['regexes']);
    }

    private function matcher(array $lists): GeoSiteMatcher
    {
        return new GeoSiteMatcher(fn (string $tag) => $lists[$tag] ?? null);
    }
}
