<?php

namespace App\Services;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

final class GeoSiteMatcher
{
    private const DEFAULT_TTL = 86400;

    /** @var array<string, array<string, array<int, string>>> */
    private array $patternsCache = [];

    public function __construct(
        private readonly mixed $loader = null,
        private readonly ?string $cacheDir = null,
        private readonly int $ttl = self::DEFAULT_TTL
    ) {
    }

    /**
     * GeoSite collections are ORed. Return null when at least one collection
     * could not be loaded and no collection matched.
     */
    public function matchesAny(string $domain, array $tags): ?bool
    {
        $domain = strtolower(trim(rtrim($domain, '.')));
        if ($domain === '' || $tags === []) {
            return null;
        }

        $unknown = false;
        foreach ($tags as $tag) {
            $match = $this->matchesTag($domain, trim((string) $tag));
            if ($match === true) {
                return true;
            }
            if ($match === null) {
                $unknown = true;
            }
        }
        return $unknown ? null : false;
    }

    public function matchesTag(string $domain, string $tag): ?bool
    {
        if ($tag === '') {
            return null;
        }
        $patterns = $this->patterns($tag);
        if ($patterns === null) {
            return null;
        }

        if (in_array($domain, $patterns['domains'], true)) {
            return true;
        }
        foreach ($patterns['suffixes'] as $suffix) {
            if ($domain === $suffix || str_ends_with($domain, '.' . $suffix)) {
                return true;
            }
        }
        foreach ($patterns['keywords'] as $keyword) {
            if ($keyword !== '' && str_contains($domain, $keyword)) {
                return true;
            }
        }
        foreach ($patterns['regexes'] as $regex) {
            $pattern = '~' . str_replace('~', '\~', $regex) . '~iu';
            if (@preg_match($pattern, $domain) === 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * @return array{domains: array<int, string>, suffixes: array<int, string>, keywords: array<int, string>, regexes: array<int, string>}|null
     */
    public static function parseList(string $content): array
    {
        $patterns = [
            'domains' => [],
            'suffixes' => [],
            'keywords' => [],
            'regexes' => [],
        ];
        foreach (preg_split('/\R/u', $content) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $line = preg_replace('/\s+@.*$/', '', $line) ?? $line;
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (str_starts_with($line, '+.')) {
                $patterns['suffixes'][] = strtolower(substr($line, 2));
            } elseif (str_starts_with($line, 'full:')) {
                $patterns['domains'][] = strtolower(substr($line, 5));
            } elseif (str_starts_with($line, 'domain:')) {
                $patterns['suffixes'][] = strtolower(substr($line, 7));
            } elseif (str_starts_with($line, 'keyword:')) {
                $patterns['keywords'][] = strtolower(substr($line, 8));
            } elseif (str_starts_with($line, 'regexp:')) {
                $patterns['regexes'][] = substr($line, 7);
            } elseif (str_starts_with($line, 'regex:')) {
                $patterns['regexes'][] = substr($line, 6);
            } else {
                $patterns['domains'][] = strtolower($line);
            }
        }
        foreach ($patterns as $kind => $values) {
            $patterns[$kind] = array_values(array_unique(array_filter(
                $values,
                fn (string $value) => $value !== ''
            )));
        }
        return $patterns;
    }

    private function patterns(string $tag): ?array
    {
        if (array_key_exists($tag, $this->patternsCache)) {
            return $this->patternsCache[$tag];
        }

        $content = $this->load($tag);
        if ($content === null) {
            return null;
        }
        return $this->patternsCache[$tag] = self::parseList($content);
    }

    private function load(string $tag): ?string
    {
        if ($this->loader !== null) {
            try {
                $value = ($this->loader)($tag);
                return is_string($value) && trim($value) !== '' ? $value : null;
            } catch (\Throwable) {
                return null;
            }
        }

        if (preg_match('/^[a-z0-9!@._+-]+$/i', $tag) !== 1) {
            return null;
        }
        $cacheDir = $this->cacheDir ?: storage_path('app/geosite');
        $cacheFile = $cacheDir . '/' . preg_replace('/[^a-z0-9._-]+/i', '_', $tag) . '.list';
        if (is_file($cacheFile) && filemtime($cacheFile) >= time() - max(300, $this->ttl)) {
            $cached = @file_get_contents($cacheFile);
            return is_string($cached) && trim($cached) !== '' ? $cached : null;
        }

        try {
            $url = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/'
                . rawurlencode($tag) . '.list';
            $response = Http::timeout(8)->retry(1, 200)->get($url);
            if (!$response->successful() || trim($response->body()) === '') {
                return null;
            }
            File::ensureDirectoryExists($cacheDir, 0755);
            $tmp = $cacheFile . '.' . bin2hex(random_bytes(4)) . '.tmp';
            if (@file_put_contents($tmp, $response->body(), LOCK_EX) === false) {
                return null;
            }
            if (!@rename($tmp, $cacheFile)) {
                @unlink($tmp);
                return null;
            }
            @chmod($cacheFile, 0644);
            return $response->body();
        } catch (\Throwable) {
            return null;
        }
    }
}
