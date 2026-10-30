<?php

namespace App\Services;

final class RouteRuleAnalyzer
{
    /**
     * Analyze ordered route rules without guessing about CIDR or regex overlap.
     *
     * @param iterable<mixed> $routes
     * @param array<int, array<int>> $bindingsByRoute
     * @param array<int, array<string>> $outboundTagsByServer
     * @return array<int, array<int, array<string, mixed>>>
     */
    public static function analyze(
        iterable $routes,
        array $bindingsByRoute = [],
        array $outboundTagsByServer = []
    ): array {
        $ordered = is_array($routes) ? array_values($routes) : iterator_to_array($routes, false);
        usort($ordered, function ($left, $right) {
            $priority = (int) self::value($left, 'priority', 100) <=> (int) self::value($right, 'priority', 100);
            return $priority !== 0
                ? $priority
                : (int) self::value($left, 'id', 0) <=> (int) self::value($right, 'id', 0);
        });

        $result = [];
        $firstByMatcher = [];

        foreach ($ordered as $route) {
            $id = (int) self::value($route, 'id', 0);
            $enabled = (bool) self::value($route, 'enabled', true);
            $diagnostics = [];
            $serverIds = array_values(array_unique(array_map(
                'intval',
                $bindingsByRoute[$id] ?? []
            )));

            if ($enabled && $serverIds === []) {
                $diagnostics[] = [
                    'code' => 'unbound_rule',
                    'severity' => 'info',
                    'message' => '规则已启用，但尚未绑定任何节点。',
                ];
            }

            $action = strtolower(trim((string) self::value($route, 'action', '')));
            $target = trim((string) self::value($route, 'action_value', ''));
            if ($enabled && $action === 'proxy' && $target !== '' && $serverIds !== []) {
                $missing = array_values(array_filter($serverIds, function (int $serverId) use ($target, $outboundTagsByServer) {
                    $tags = array_map(
                        fn ($tag) => strtolower(trim((string) $tag)),
                        $outboundTagsByServer[$serverId] ?? []
                    );
                    return !in_array(strtolower($target), $tags, true);
                }));
                if ($missing !== []) {
                    $diagnostics[] = [
                        'code' => 'missing_proxy_target',
                        'severity' => 'warning',
                        'server_ids' => $missing,
                        'message' => sprintf(
                            '出站 Tag “%s”未在 %d 个绑定节点的面板出站中发现；节点本地 custom_config 中定义的 Tag 不在此检查范围。',
                            $target,
                            count($missing)
                        ),
                    ];
                }
            }

            if ($enabled) {
                $matcher = self::matcherSignature($route);
                if ($matcher !== null && isset($firstByMatcher[$matcher])) {
                    $first = $firstByMatcher[$matcher];
                    $sameAction = self::actionSignature($route) === $first['action_signature'];
                    $diagnostics[] = [
                        'code' => $sameAction ? 'duplicate_rule' : 'shadowed_rule',
                        'severity' => $sameAction ? 'warning' : 'error',
                        'related_route_id' => $first['id'],
                        'message' => $sameAction
                            ? sprintf('与更高优先级规则 #%d 的匹配条件和动作完全相同，本规则不会产生额外效果。', $first['id'])
                            : sprintf('匹配条件与更高优先级规则 #%d 完全相同，本规则会被其动作遮蔽。', $first['id']),
                    ];
                } elseif ($matcher !== null) {
                    $firstByMatcher[$matcher] = [
                        'id' => $id,
                        'action_signature' => self::actionSignature($route),
                    ];
                }
            }

            $result[$id] = $diagnostics;
        }

        return $result;
    }

    private static function matcherSignature(mixed $route): ?string
    {
        $criteria = self::value($route, 'criteria');
        if (is_array($criteria)) {
            $canonical = [];
            $hasValues = false;
            foreach (RouteRuleValidator::CRITERIA_KEYS as $key) {
                $canonical[$key] = self::canonicalValues($criteria[$key] ?? []);
                $hasValues = $hasValues || $canonical[$key] !== [];
            }
            if ($hasValues) {
                return self::encode([
                    'structured',
                    strtolower(trim((string) self::value($route, 'match_mode', 'any'))) ?: 'any',
                    $canonical,
                ]);
            }
        }

        $legacy = array_map(
            fn ($value) => strtolower(trim((string) $value)),
            is_array(self::value($route, 'match', [])) ? self::value($route, 'match', []) : []
        );
        $legacy = array_values(array_unique(array_filter($legacy, fn ($value) => $value !== '')));
        sort($legacy, SORT_STRING);

        return $legacy === [] ? null : self::encode(['legacy', $legacy]);
    }

    private static function actionSignature(mixed $route): string
    {
        $action = strtolower(trim((string) self::value($route, 'action', '')));
        $target = $action === 'proxy'
            ? strtolower(trim((string) self::value($route, 'action_value', '')))
            : '';

        return self::encode([$action, $target]);
    }

    private static function canonicalValues(mixed $values): array
    {
        if (!is_array($values)) {
            return [];
        }
        $values = array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $values
        ), fn ($value) => $value !== '')));
        sort($values, SORT_STRING);
        return $values;
    }

    private static function value(mixed $route, string $key, mixed $default = null): mixed
    {
        if (is_array($route)) {
            return array_key_exists($key, $route) ? $route[$key] : $default;
        }
        if (is_object($route)) {
            return $route->{$key} ?? $default;
        }
        return $default;
    }

    private static function encode(array $value): string
    {
        return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
