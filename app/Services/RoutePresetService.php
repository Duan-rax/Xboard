<?php

namespace App\Services;

use App\Models\EgressProxy;
use App\Models\Server;
use App\Models\ServerRoute;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class RoutePresetService
{
    public const ADS_KEY = 'builtin-ads';
    public const BT_KEY = 'builtin-bittorrent';
    public const AI_KEY = 'builtin-ai-egress';

    public const AI_DOMAIN_SUFFIXES = [
        'openai.com',
        'chatgpt.com',
        'oaistatic.com',
        'oaiusercontent.com',
        'anthropic.com',
        'claude.ai',
        'generativelanguage.googleapis.com',
        'aistudio.google.com',
        'gemini.google.com',
        'cohere.ai',
        'perplexity.ai',
        'mistral.ai',
        'groq.com',
        'x.ai',
        'copilot.microsoft.com',
        'githubcopilot.com',
        'poe.com',
        'huggingface.co',
        'replicate.com',
    ];

    public static function definitions(): array
    {
        return [
            [
                'key' => self::ADS_KEY,
                'title' => '广告、统计与遥测',
                'description' => '合并 CATEGORY-ADS-ALL 与 CATEGORY-ADS-AND-TELEMETRY，统一阻断。',
                'action' => 'block',
            ],
            [
                'key' => self::BT_KEY,
                'title' => 'BitTorrent、BT/PT 站点与 Tracker',
                'description' => '合并 bittorrent 协议嗅探、CATEGORY-PT 集合和现有客户端/Tracker 域名。',
                'action' => 'block',
            ],
            [
                'key' => self::AI_KEY,
                'title' => 'AI 服务走管理出站',
                'description' => '合并常见 AI 域名，并只绑定到所选管理出站正在使用的节点。',
                'action' => 'proxy',
            ],
        ];
    }

    public function applyAll(int $egressProxyId): array
    {
        $proxy = EgressProxy::find($egressProxyId);
        if (!$proxy || !$proxy->enabled) {
            throw ValidationException::withMessages([
                'egress_proxy_id' => ['请选择一个已启用的管理出站。'],
            ]);
        }

        $affectedServerIds = collect();
        $result = DB::transaction(function () use ($proxy, &$affectedServerIds): array {
            $ads = $this->applyBlockingPreset(
                self::ADS_KEY,
                fn (ServerRoute $route) => $this->isAdsRoute($route)
            );
            $affectedServerIds = $affectedServerIds->merge($ads['server_ids']);

            $bt = $this->applyBlockingPreset(
                self::BT_KEY,
                fn (ServerRoute $route) => $this->isBitTorrentRoute($route)
            );
            $affectedServerIds = $affectedServerIds->merge($bt['server_ids']);

            $ai = $this->applyAiPreset($proxy);
            $affectedServerIds = $affectedServerIds->merge($ai['server_ids']);

            return [
                'ads' => $ads,
                'bittorrent' => $bt,
                'ai' => $ai,
            ];
        });

        $serverIds = $affectedServerIds->map(fn ($id) => (int) $id)->unique()->values();
        if ($serverIds->isNotEmpty()) {
            ServerService::bumpConfigRevision($serverIds->all());
            foreach ($serverIds as $serverId) {
                Cache::forget("node_config_applied:{$serverId}");
                NodeSyncService::notifyConfigUpdated($serverId);
            }
        }
        $result['affected_server_ids'] = $serverIds;
        $result['egress_proxy'] = [
            'id' => $proxy->id,
            'name' => $proxy->name,
        ];
        return $result;
    }

    private function applyBlockingPreset(string $presetKey, callable $matcher): array
    {
        $routes = ServerRoute::query()->lockForUpdate()->orderBy('priority')->orderBy('id')->get();
        $matched = $routes->filter($matcher)->values();
        $canonical = $matched->first();
        $criteria = $this->mergeCriteria($matched);

        if ($presetKey === self::ADS_KEY) {
            $criteria['geosite'] = $this->uniqueStrings(array_merge(
                $criteria['geosite'],
                ['category-ads-all', 'category-ads-and-telemetry']
            ));
            $criteria['protocols'] = [];
            $remarks = '阻断广告、统计与遥测';
            $priority = 5;
        } else {
            $criteria['protocols'] = ['bittorrent'];
            $criteria['geosite'] = $this->uniqueStrings(array_merge(
                $criteria['geosite'],
                ['category-pt@!cn']
            ));
            $remarks = '阻断 BitTorrent、BT/PT 站点与 Tracker';
            $priority = $matched->min('priority') ?? 40;
        }
        $criteria = RouteRuleValidator::normalizeCriteria($criteria);

        if ($canonical === null) {
            $canonical = ServerRoute::create([
                'remarks' => $remarks,
                'preset_key' => $presetKey,
                'criteria' => $criteria,
                'match' => [],
                'match_mode' => 'any',
                'priority' => $priority,
                'enabled' => true,
                'action' => 'block',
                'action_value' => null,
            ]);
        } else {
            $canonical->fill([
                'remarks' => $remarks,
                'preset_key' => $presetKey,
                'criteria' => $criteria,
                'match' => [],
                'match_mode' => 'any',
                'priority' => $priority,
                'enabled' => true,
                'action' => 'block',
                'action_value' => null,
            ])->saveQuietly();
        }

        $routeIds = $matched->pluck('id')->map(fn ($id) => (int) $id)->push((int) $canonical->id)->unique();
        $serverIds = $this->replaceBindings($routeIds->all(), (int) $canonical->id);
        $removed = $matched
            ->where('id', '!=', $canonical->id)
            ->each(fn (ServerRoute $route) => $route->deleteQuietly())
            ->count();

        return [
            'route_id' => (int) $canonical->id,
            'merged_routes' => $matched->count(),
            'removed_duplicates' => $removed,
            'server_ids' => $serverIds,
        ];
    }

    private function applyAiPreset(EgressProxy $proxy): array
    {
        $routes = ServerRoute::query()->lockForUpdate()->orderBy('priority')->orderBy('id')->get();
        $candidates = $routes->filter(fn (ServerRoute $route) => $this->isAiRoute($route))->values();
        $canonical = $candidates->first();
        $target = 'panel-egress-' . $proxy->id;
        $criteria = RouteRuleValidator::normalizeCriteria([
            'domain_suffixes' => self::AI_DOMAIN_SUFFIXES,
        ]);

        if ($canonical === null) {
            $canonical = ServerRoute::create([
                'remarks' => 'AI 服务走管理出站',
                'preset_key' => self::AI_KEY,
                'criteria' => $criteria,
                'match' => [],
                'match_mode' => 'any',
                'priority' => 60,
                'enabled' => true,
                'action' => 'proxy',
                'action_value' => $target,
            ]);
        } else {
            $canonical->fill([
                'remarks' => 'AI 服务走管理出站',
                'preset_key' => self::AI_KEY,
                'criteria' => $criteria,
                'match' => [],
                'match_mode' => 'any',
                'priority' => $canonical->priority ?: 60,
                'enabled' => true,
                'action' => 'proxy',
                'action_value' => $target,
            ])->saveQuietly();
        }

        $candidateIds = $candidates->pluck('id')->map(fn ($id) => (int) $id)->push((int) $canonical->id)->unique();
        $changed = [];
        foreach (Server::query()->lockForUpdate()->get() as $server) {
            $routeIds = collect($server->route_ids ?? [])->map(fn ($id) => (int) $id);
            $before = $routeIds->all();
            $routeIds = $routeIds->reject(fn ($id) => $candidateIds->contains($id));
            if ((int) $server->egress_proxy_id === (int) $proxy->id) {
                $routeIds->push((int) $canonical->id);
            }
            $routeIds = $routeIds->unique()->values();
            if ($routeIds->all() !== $before) {
                $server->route_ids = $routeIds->all();
                $server->save();
                $changed[] = (int) $server->id;
            }
        }
        $removed = $candidates
            ->where('id', '!=', $canonical->id)
            ->each(fn (ServerRoute $route) => $route->deleteQuietly())
            ->count();
        return [
            'route_id' => (int) $canonical->id,
            'merged_routes' => $candidates->count(),
            'removed_duplicates' => $removed,
            'server_ids' => $changed,
            'bound_server_count' => Server::query()->where('egress_proxy_id', $proxy->id)->count(),
        ];
    }

    private function replaceBindings(array $routeIds, int $canonicalId): array
    {
        $routeIds = collect($routeIds)->map(fn ($id) => (int) $id)->unique();
        $changed = [];
        foreach (Server::query()->lockForUpdate()->get() as $server) {
            $current = collect($server->route_ids ?? [])->map(fn ($id) => (int) $id);
            $before = $current->all();
            $contains = $current->contains(fn ($id) => $routeIds->contains($id));
            if (!$contains && $routeIds->isEmpty()) {
                continue;
            }
            $next = $current->reject(fn ($id) => $routeIds->contains($id));
            if ($contains) $next->push($canonicalId);
            $next = $next->unique()->values();
            if ($next->all() !== $before) {
                $server->route_ids = $next->all();
                $server->save();
                $changed[] = (int) $server->id;
            }
        }
        return $changed;
    }

    private function mergeCriteria(Collection $routes): array
    {
        $criteria = array_fill_keys(RouteRuleValidator::CRITERIA_KEYS, []);
        foreach ($routes as $route) {
            $routeCriteria = RouteRuleValidator::hasCriteria($route->criteria)
                ? RouteRuleValidator::normalizeCriteria($route->criteria ?? [])
                : RouteRuleValidator::criteriaFromLegacyMatch($route->match ?? []);
            foreach (RouteRuleValidator::CRITERIA_KEYS as $key) {
                $criteria[$key] = array_merge($criteria[$key], $routeCriteria[$key] ?? []);
            }
        }
        foreach ($criteria as $key => $values) {
            $criteria[$key] = $this->uniqueStrings($values);
        }
        return $criteria;
    }

    private function isAdsRoute(ServerRoute $route): bool
    {
        if ($route->preset_key === self::ADS_KEY) return true;
        if (strtolower((string) $route->action) !== 'block') return false;
        $geosite = RouteRuleValidator::normalizeCriteria($route->criteria ?? [])['geosite'];
        foreach ($geosite as $value) {
            if (str_starts_with(strtolower($value), 'category-ads')) return true;
        }
        return false;
    }

    private function isBitTorrentRoute(ServerRoute $route): bool
    {
        if ($route->preset_key === self::BT_KEY) return true;
        if (strtolower((string) $route->action) !== 'block') return false;
        $criteria = RouteRuleValidator::normalizeCriteria($route->criteria ?? []);
        if (in_array('bittorrent', $criteria['protocols'], true)) return true;
        foreach ($criteria['geosite'] as $value) {
            if (str_starts_with(strtolower($value), 'category-pt')) return true;
        }
        return preg_match('/(?:^|[^a-z])(?:bt|bittorrent|pt|tracker)(?:[^a-z]|$)/i', (string) $route->remarks) === 1;
    }

    private function isAiRoute(ServerRoute $route): bool
    {
        if ($route->preset_key === self::AI_KEY) return true;
        if (strtolower((string) $route->action) !== 'proxy') return false;
        $criteria = RouteRuleValidator::normalizeCriteria($route->criteria ?? []);
        $suffixes = collect($criteria['domain_suffixes'])->map(fn ($value) => strtolower($value));
        return $suffixes->contains(fn ($value) => in_array($value, ['openai.com', 'chatgpt.com', 'anthropic.com', 'claude.ai'], true));
    }

    private function uniqueStrings(array $values): array
    {
        return collect($values)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }
}
