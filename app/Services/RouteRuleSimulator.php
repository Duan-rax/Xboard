<?php

namespace App\Services;

class RouteRuleSimulator
{
    /**
     * Simulate the panel-managed route ordering for one node and target.
     * GeoIP/GeoSite membership can be resolved by callers that provide the
     * corresponding matcher. Rule-set membership remains indeterminate.
     */
    public static function simulate(
        iterable $routes,
        array $node,
        array $target,
        array $resolvers = []
    ): array
    {
        $ordered = is_array($routes) ? array_values($routes) : iterator_to_array($routes, false);
        usort($ordered, function ($left, $right) {
            return [(int) self::value($left, 'priority', 100), (int) self::value($left, 'id', 0)]
                <=> [(int) self::value($right, 'priority', 100), (int) self::value($right, 'id', 0)];
        });

        $trace = [];
        $firstMatch = null;
        $firstPossible = null;
        foreach ($ordered as $route) {
            if (!(bool) self::value($route, 'enabled', true)) {
                continue;
            }
            $criteria = self::criteria($route);
            $evaluation = self::evaluate(
                $criteria,
                (string) self::value($route, 'match_mode', 'any'),
                $target,
                $resolvers
            );
            $item = [
                'route_id' => (int) self::value($route, 'id', 0),
                'remarks' => (string) self::value($route, 'remarks', ''),
                'priority' => (int) self::value($route, 'priority', 100),
                'match_mode' => strtolower((string) self::value($route, 'match_mode', 'any')) ?: 'any',
                'status' => $evaluation['status'],
                'action' => (string) self::value($route, 'action', 'direct'),
                'target' => (string) self::value($route, 'action_value', ''),
                'matched_criteria' => $evaluation['matched'],
                'indeterminate_criteria' => $evaluation['indeterminate'],
                'expanded_rules' => self::expandedLabels((int) self::value($route, 'id', 0), $criteria),
            ];
            $trace[] = $item;
            if ($firstMatch === null && $evaluation['status'] === 'match') {
                $firstMatch = $item;
            } elseif ($firstPossible === null && $evaluation['status'] === 'indeterminate') {
                $firstPossible = $item;
            }
        }

        $effective = $firstMatch;
        $shadowed = [];
        if ($firstMatch !== null) {
            $seen = false;
            foreach ($trace as $item) {
                if ($item['route_id'] === $firstMatch['route_id']) {
                    $seen = true;
                    continue;
                }
                if ($seen && $item['status'] !== 'no_match') {
                    $shadowed[] = [
                        'route_id' => $item['route_id'],
                        'remarks' => $item['remarks'],
                        'status' => $item['status'],
                    ];
                }
            }
        }

        $warnings = [];
        if ($effective !== null) {
            $finalAction = $effective['action'];
            $finalOutbound = $finalAction === 'proxy'
                ? $effective['target']
                : ($finalAction === 'dns' ? 'dns-out' : $finalAction);
            if ($finalAction === 'proxy'
                && preg_match('/^panel-egress-(\d+)$/', (string) $finalOutbound, $matches) === 1
                && !in_array((int) $matches[1], array_map('intval', $node['available_egress_ids'] ?? []), true)) {
                $finalAction = 'block';
                $finalOutbound = 'block';
                $warnings[] = '目标管理出站尚未授权到该节点；运行时会 fail-closed，将规则转换为阻断。';
            }
        } elseif ($firstPossible === null) {
            if (!empty($node['egress_proxy_id']) && !empty($node['egress_proxy_enabled'])) {
                $finalAction = 'proxy';
                $finalOutbound = 'panel-egress-' . (int) $node['egress_proxy_id'];
            } else {
                $finalAction = 'direct';
                $finalOutbound = 'direct';
            }
        } else {
            $finalAction = null;
            $finalOutbound = null;
        }

        if ($firstPossible !== null && $firstMatch === null) {
            $criteria = implode('/', $firstPossible['indeterminate_criteria']);
            $warnings[] = sprintf(
                '首条可能命中的规则 #%d 无法确定 %s 成员关系，因此不推断最终动作。',
                $firstPossible['route_id'],
                $criteria
            );
        }
        if (!empty($node['custom_routes'])) {
            $warnings[] = '节点还包含 local custom_routes；它们优先于面板规则，模拟器无法读取本地文件后的最终顺序。';
        }
        if (($node['kernel'] ?? '') === 'xray'
            && ($node['domain_strategy'] ?? 'AsIs') === 'AsIs'
            && (self::hasIpCriteria($ordered) || !empty($target['destination']) && empty($target['destination_ip']))) {
            $warnings[] = '该 Xray 节点使用 domainStrategy=AsIs。若希望域名解析后继续匹配 IP/CIDR，请将节点 domain_strategy 设为 IPIfNonMatch。';
        }

        return [
            'node' => $node,
            'target' => $target,
            'matched_rule' => $firstMatch,
            'possible_rule' => $firstMatch === null ? $firstPossible : null,
            'final_action' => $finalAction,
            'final_outbound' => $finalOutbound,
            'shadowed_rules' => $shadowed,
            'trace' => $trace,
            'warnings' => $warnings,
        ];
    }

    private static function evaluate(
        array $criteria,
        string $matchMode,
        array $target,
        array $resolvers
    ): array
    {
        $domain = strtolower(trim((string) ($target['domain'] ?? '')));
        $destinationIp = trim((string) ($target['destination_ip'] ?? ''));
        $statuses = [
            'domains' => self::domainStatus($criteria['domains'] ?? [], $target),
            'domain_suffixes' => self::suffixStatus($criteria['domain_suffixes'] ?? [], $target),
            'domain_keywords' => self::keywordStatus($criteria['domain_keywords'] ?? [], $target),
            'domain_regexes' => self::regexStatus($criteria['domain_regexes'] ?? [], $target),
            'ip_cidrs' => self::networkStatus($criteria['ip_cidrs'] ?? [], $target['destination_ip'] ?? ''),
            'ports' => self::rangeStatus($criteria['ports'] ?? [], $target['port'] ?? null),
            'networks' => self::exactStatus($criteria['networks'] ?? [], $target['network'] ?? ''),
            'source_cidrs' => self::networkStatus($criteria['source_cidrs'] ?? [], $target['source_ip'] ?? ''),
            'source_ports' => self::rangeStatus($criteria['source_ports'] ?? [], $target['source_port'] ?? null),
            'protocols' => self::exactStatus($criteria['protocols'] ?? [], $target['protocol'] ?? ''),
            'geoip' => self::geoIpStatus(
                $criteria['geoip'] ?? [],
                $destinationIp,
                $resolvers['geoip'] ?? null
            ),
            'geosite' => self::geoSiteStatus(
                $criteria['geosite'] ?? [],
                $domain,
                $resolvers['geosite'] ?? null
            ),
            'rule_sets' => self::unknownStatus($criteria['rule_sets'] ?? []),
        ];
        $active = array_filter($statuses, fn ($status) => $status !== null);
        $matched = array_keys(array_filter($active, fn ($status) => $status === true));
        $indeterminate = array_keys(array_filter($active, fn ($status) => $status === 'unknown'));
        if ($active === []) {
            $status = 'no_match';
        } elseif ($matchMode === 'all') {
            $status = in_array(false, $active, true)
                ? 'no_match'
                : ($indeterminate === [] ? 'match' : 'indeterminate');
        } else {
            $status = in_array(true, $active, true)
                ? 'match'
                : ($indeterminate === [] ? 'no_match' : 'indeterminate');
        }
        return ['status' => $status, 'matched' => $matched, 'indeterminate' => $indeterminate];
    }

    private static function criteria(mixed $route): array
    {
        $criteria = self::value($route, 'criteria');
        if (is_array($criteria) && RouteRuleValidator::hasCriteria($criteria)) {
            return RouteRuleValidator::normalizeCriteria($criteria);
        }
        $legacy = self::value($route, 'match', []);
        return RouteRuleValidator::criteriaFromLegacyMatch(is_array($legacy) ? $legacy : []);
    }

    private static function domainStatus(array $values, array $target): ?bool
    {
        if ($values === []) return null;
        $domain = strtolower(trim((string) ($target['domain'] ?? '')));
        if ($domain === '') return null;
        return in_array($domain, array_map('strtolower', $values), true);
    }

    private static function suffixStatus(array $values, array $target): ?bool
    {
        if ($values === []) return null;
        $domain = strtolower(trim((string) ($target['domain'] ?? '')));
        if ($domain === '') return null;
        foreach ($values as $suffix) {
            $suffix = strtolower(ltrim(trim((string) $suffix), '*.'));
            if ($suffix !== '' && ($domain === $suffix || str_ends_with($domain, '.' . $suffix))) {
                return true;
            }
        }
        return false;
    }

    private static function keywordStatus(array $values, array $target): ?bool
    {
        if ($values === []) return null;
        $domain = strtolower(trim((string) ($target['domain'] ?? '')));
        if ($domain === '') return null;
        foreach ($values as $value) {
            if ($value !== '' && str_contains($domain, strtolower((string) $value))) return true;
        }
        return false;
    }

    private static function regexStatus(array $values, array $target): ?bool
    {
        if ($values === []) return null;
        $domain = strtolower(trim((string) ($target['domain'] ?? '')));
        if ($domain === '') return null;
        foreach ($values as $value) {
            $pattern = '~' . str_replace('~', '\\~', (string) $value) . '~u';
            if (@preg_match($pattern, $domain) === 1) return true;
        }
        return false;
    }

    private static function networkStatus(array $values, string $ip): ?bool
    {
        if ($values === []) return null;
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) return null;
        foreach ($values as $cidr) {
            if (self::ipInCidr($ip, (string) $cidr)) return true;
        }
        return false;
    }

    private static function rangeStatus(array $values, mixed $number): ?bool
    {
        if ($values === []) return null;
        if ($number === null || $number === '') return null;
        $number = (int) $number;
        foreach ($values as $spec) {
            [$start, $end] = array_pad(explode('-', str_replace(':', '-', (string) $spec), 2), 2, null);
            $start = (int) $start;
            $end = $end === null ? $start : (int) $end;
            if ($number >= $start && $number <= $end) return true;
        }
        return false;
    }

    private static function exactStatus(array $values, string $actual): ?bool
    {
        if ($values === []) return null;
        if (trim($actual) === '') return null;
        return in_array(strtolower(trim($actual)), array_map(fn ($value) => strtolower(trim((string) $value)), $values), true);
    }

    private static function unknownStatus(array $values): mixed
    {
        return $values === [] ? null : 'unknown';
    }

    private static function geoSiteStatus(array $values, string $domain, mixed $resolver): mixed
    {
        if ($values === []) {
            return null;
        }
        if ($domain === '' || !is_callable($resolver)) {
            return 'unknown';
        }
        try {
            $result = $resolver($values, $domain);
            return is_bool($result) ? $result : 'unknown';
        } catch (\Throwable) {
            return 'unknown';
        }
    }

    private static function geoIpStatus(array $values, string $ip, mixed $resolver): mixed
    {
        if ($values === []) {
            return null;
        }
        if ($ip === '' || !is_callable($resolver)) {
            return 'unknown';
        }
        try {
            $result = $resolver($values, $ip);
            return is_bool($result) ? $result : 'unknown';
        } catch (\Throwable) {
            return 'unknown';
        }
    }

    private static function ipInCidr(string $ip, string $cidr): bool
    {
        [$network, $prefix] = array_pad(explode('/', $cidr, 2), 2, null);
        $ipPacked = @inet_pton($ip);
        $networkPacked = @inet_pton($network);
        if ($ipPacked === false || $networkPacked === false || strlen($ipPacked) !== strlen($networkPacked)) {
            return false;
        }
        $bits = $prefix === null ? strlen($ipPacked) * 8 : (int) $prefix;
        $bytes = intdiv($bits, 8);
        $remainder = $bits % 8;
        if ($bytes > 0 && substr($ipPacked, 0, $bytes) !== substr($networkPacked, 0, $bytes)) {
            return false;
        }
        if ($remainder === 0) return true;
        $mask = (0xff << (8 - $remainder)) & 0xff;
        return (ord($ipPacked[$bytes]) & $mask) === (ord($networkPacked[$bytes]) & $mask);
    }

    private static function expandedLabels(int $routeId, array $criteria): array
    {
        $labels = [];
        $index = 0;
        foreach (RouteRuleValidator::CRITERIA_KEYS as $key) {
            if (!empty($criteria[$key])) {
                $labels[] = "panel-route-{$routeId}-{$index}:{$key}";
                $index += 1;
            }
        }
        return $labels;
    }

    private static function hasIpCriteria(array $routes): bool
    {
        foreach ($routes as $route) {
            $criteria = self::criteria($route);
            if (!empty($criteria['ip_cidrs']) || !empty($criteria['geoip'])) return true;
        }
        return false;
    }

    private static function value(mixed $item, string $key, mixed $default = null): mixed
    {
        if (is_array($item)) return array_key_exists($key, $item) ? $item[$key] : $default;
        if (is_object($item)) return $item->{$key} ?? $default;
        return $default;
    }
}
