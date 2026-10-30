<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

class RouteRuleValidator
{
    public const MAX_VALUES_PER_FIELD = 1000;
    public const MAX_TOTAL_VALUES = 2000;
    public const MAX_EXPANDED_RULES = 200;

    public const CRITERIA_KEYS = [
        'domains',
        'domain_suffixes',
        'domain_keywords',
        'domain_regexes',
        'ip_cidrs',
        'ports',
        'networks',
        'source_cidrs',
        'source_ports',
        'protocols',
        'geoip',
        'geosite',
        'rule_sets',
    ];

    public static function normalizeCriteria(array $raw): array
    {
        $criteria = [];
        foreach (self::CRITERIA_KEYS as $key) {
            $criteria[$key] = self::normalizeValues($raw[$key] ?? []);
        }

        $criteria['domains'] = array_map(
            fn ($value) => self::normalizeDomain($value),
            $criteria['domains']
        );
        $criteria['domain_suffixes'] = array_map(
            fn ($value) => ltrim(self::normalizeDomain($value), '*.'),
            $criteria['domain_suffixes']
        );
        $criteria['domain_keywords'] = array_map(
            fn ($value) => self::normalizeDomainKeyword($value),
            $criteria['domain_keywords']
        );
        $criteria['domain_regexes'] = array_map(
            fn ($value) => self::normalizeDomainRegex($value),
            $criteria['domain_regexes']
        );
        $criteria['ip_cidrs'] = array_map(
            fn ($value) => self::normalizeCidr($value),
            $criteria['ip_cidrs']
        );
        $criteria['source_cidrs'] = array_map(
            fn ($value) => self::normalizeCidr($value),
            $criteria['source_cidrs']
        );
        $criteria['ports'] = array_map(
            fn ($value) => self::normalizePortSpec($value, '端口'),
            $criteria['ports']
        );
        $criteria['source_ports'] = array_map(
            fn ($value) => self::normalizePortSpec($value, '来源端口'),
            $criteria['source_ports']
        );
        $criteria['networks'] = array_map(
            fn ($value) => self::normalizeNetwork($value),
            $criteria['networks']
        );
        $criteria['protocols'] = array_map(
            fn ($value) => self::normalizeProtocol($value),
            $criteria['protocols']
        );
        $criteria['geoip'] = array_map(
            fn ($value) => self::normalizeGeoCode($value, 'geoip'),
            $criteria['geoip']
        );
        $criteria['geosite'] = array_map(
            fn ($value) => self::normalizeGeoCode($value, 'geosite'),
            $criteria['geosite']
        );
        $criteria['rule_sets'] = array_map(
            fn ($value) => self::normalizeRuleSetTag($value),
            $criteria['rule_sets']
        );

        foreach ($criteria as $key => $values) {
            $criteria[$key] = array_values(array_unique(array_filter($values)));
        }

        return $criteria;
    }

    public static function hasCriteria(?array $criteria): bool
    {
        if (!$criteria) {
            return false;
        }
        foreach (self::CRITERIA_KEYS as $key) {
            if (!empty($criteria[$key])) {
                return true;
            }
        }
        return false;
    }

    public static function criteriaFromLegacyMatch(array $match): array
    {
        $criteria = array_fill_keys(self::CRITERIA_KEYS, []);
        foreach ($match as $item) {
            $item = trim((string) $item);
            if ($item === '') {
                continue;
            }
            $item = preg_replace('#^[a-z]+://#i', '', $item);
            if (str_contains($item, '/') || filter_var(explode('/', $item, 2)[0], FILTER_VALIDATE_IP)) {
                $criteria['ip_cidrs'][] = $item;
            } else {
                $criteria['domain_suffixes'][] = ltrim($item, '*.');
            }
        }
        return self::normalizeCriteria($criteria);
    }

    public static function assertUsable(
        ?array $criteria,
        array $legacyMatch,
        string $action,
        ?string $target,
        string $matchMode = 'any'
    ): void
    {
        if ($action === 'proxy' && !$target) {
            throw ValidationException::withMessages([
                'action_value' => ['配置了“指定出站”动作时必须填写目标 Tag。'],
            ]);
        }
        if (!self::hasCriteria($criteria) && empty(array_filter($legacyMatch))) {
            throw ValidationException::withMessages([
                'criteria' => ['至少填写一个匹配条件。'],
            ]);
        }
        $total = 0;
        foreach (self::CRITERIA_KEYS as $key) {
            $count = count($criteria[$key] ?? []);
            if ($count > self::MAX_VALUES_PER_FIELD) {
                throw ValidationException::withMessages([
                    'criteria' => ["字段 {$key} 最多允许 " . self::MAX_VALUES_PER_FIELD . ' 个值。'],
                ]);
            }
            $total += $count;
        }
        if ($total > self::MAX_TOTAL_VALUES) {
            throw ValidationException::withMessages([
                'criteria' => ['单条规则匹配值总数不能超过 ' . self::MAX_TOTAL_VALUES . '。'],
            ]);
        }
        if (self::expandedRuleCount($criteria, $matchMode) > self::MAX_EXPANDED_RULES) {
            throw ValidationException::withMessages([
                'criteria' => ['规则展开后将超过 ' . self::MAX_EXPANDED_RULES . ' 条内核规则。'],
            ]);
        }
    }

    public static function expandedRuleCount(?array $criteria, string $matchMode): int
    {
        if (!self::hasCriteria($criteria)) {
            return 0;
        }
        if ($matchMode === 'all') {
            return 1;
        }
        return count(array_filter(
            self::CRITERIA_KEYS,
            fn ($key) => !empty($criteria[$key])
        ));
    }

    private static function normalizeValues(mixed $values): array
    {
        if (is_string($values)) {
            $values = preg_split('/[\r\n,]+/', $values) ?: [];
        }
        if (!is_array($values)) {
            return [];
        }
        foreach ($values as $value) {
            if (!is_string($value) && !is_int($value) && !is_float($value)) {
                throw ValidationException::withMessages([
                    'criteria' => ['匹配条件必须是字符串或数字，不能使用嵌套对象。'],
                ]);
            }
        }
        return array_values(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $values
        ), fn ($value) => $value !== ''));
    }

    private static function normalizeDomain(string $value): string
    {
        $value = trim($value);
        $value = preg_replace('#^[a-z]+://#i', '', $value);
        $value = rtrim((string) $value, '.');
        if (preg_match('/[^\x00-\x7F]/', $value) === 1 && function_exists('idn_to_ascii')) {
            $ascii = idn_to_ascii($value, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if ($ascii !== false) {
                $value = $ascii;
            }
        }
        $value = strtolower($value);
        if ($value === '' || str_contains($value, '/') || preg_match('/\s/', $value)) {
            throw ValidationException::withMessages([
                'criteria' => ["域名格式不正确：{$value}"],
            ]);
        }
        return $value;
    }

    private static function normalizeCidr(string $value): string
    {
        $value = trim($value);
        [$ip, $prefix] = array_pad(explode('/', $value, 2), 2, null);
        $packed = @inet_pton($ip);
        if ($packed === false) {
            throw ValidationException::withMessages([
                'criteria' => ["IP 地址格式不正确：{$value}"],
            ]);
        }
        $max = strlen($packed) === 4 ? 32 : 128;
        if ($prefix !== null && (!ctype_digit($prefix) || (int) $prefix < 0 || (int) $prefix > $max)) {
            throw ValidationException::withMessages([
                'criteria' => ["CIDR 前缀格式不正确：{$value}"],
            ]);
        }
        if ($prefix === null) {
            return inet_ntop($packed);
        }
        $bits = (int) $prefix;
        $bytes = strlen($packed);
        for ($index = 0; $index < $bytes; $index += 1) {
            $remaining = $bits - ($index * 8);
            if ($remaining <= 0) {
                $packed[$index] = "\0";
            } elseif ($remaining < 8) {
                $packed[$index] = chr(ord($packed[$index]) & (0xff << (8 - $remaining)));
            }
        }
        return inet_ntop($packed) . "/{$bits}";
    }

    private static function normalizeDomainKeyword(string $value): string
    {
        $value = strtolower(trim($value));
        if ($value === '' || strlen($value) > 255 || preg_match('/[\x00-\x1F\x7F]/', $value)) {
            throw ValidationException::withMessages([
                'criteria' => ["域名关键字格式不正确：{$value}"],
            ]);
        }
        return $value;
    }

    private static function normalizeDomainRegex(string $value): string
    {
        $value = trim($value);
        // Both kernels use Go's RE2-compatible regular expressions. Reject
        // backtracking-only PCRE constructs that would fail when the node
        // compiles the rule.
        $unsupported = preg_match(
            '/\(\?(?:[=!]|<[=!]|[|#>(])|\(\*|\\\\[1-9kKgG]|(?:[*+?]|\{\d+(?:,\d*)?\})\+/',
            $value
        );
        $pattern = '~' . str_replace('~', '\\~', $value) . '~u';
        if ($value === '' || strlen($value) > 512 || preg_match('/[\x00-\x1F\x7F]/', $value)
            || $unsupported || @preg_match($pattern, '') === false) {
            throw ValidationException::withMessages([
                'criteria' => ["域名正则格式不正确：{$value}"],
            ]);
        }
        return $value;
    }

    private static function normalizePortSpec(string $value, string $label): string
    {
        $value = str_replace(':', '-', trim($value));
        if (preg_match('/^(\d{1,5})$/', $value, $match)) {
            $port = (int) $match[1];
            if ($port >= 1 && $port <= 65535) {
                return (string) $port;
            }
        }
        if (preg_match('/^(\d{1,5})-(\d{1,5})$/', $value, $match)) {
            $start = (int) $match[1];
            $end = (int) $match[2];
            if ($start >= 1 && $end <= 65535 && $start <= $end) {
                return "{$start}-{$end}";
            }
        }
        throw ValidationException::withMessages([
            'criteria' => ["{$label}格式不正确：{$value}"],
        ]);
    }

    private static function normalizeNetwork(string $value): string
    {
        $value = strtolower(trim($value));
        if (!in_array($value, ['tcp', 'udp'], true)) {
            throw ValidationException::withMessages([
                'criteria' => ["网络类型只支持 tcp 或 udp：{$value}"],
            ]);
        }
        return $value;
    }

    private static function normalizeProtocol(string $value): string
    {
        $value = strtolower(trim($value));
        if (!in_array($value, ['http', 'tls', 'quic', 'bittorrent'], true)) {
            throw ValidationException::withMessages([
                'criteria' => ["嗅探协议只支持 http、tls、quic 或 bittorrent：{$value}"],
            ]);
        }
        return $value;
    }

    private static function normalizeGeoCode(string $value, string $kind): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/^' . preg_quote($kind, '/') . '[:-]/', '', $value);
        if ($kind === 'geoip' && str_ends_with((string) $value, '_ip')) {
            $value = substr((string) $value, 0, -3);
        }
        if ($kind === 'geosite' && str_ends_with((string) $value, '_site')) {
            $value = substr((string) $value, 0, -5);
        }
        if ($value === '' || strlen((string) $value) > 128 || !preg_match('/^[a-z0-9_!@.+-]+$/', (string) $value)) {
            throw ValidationException::withMessages([
                'criteria' => [strtoupper($kind) . " 规则集名称不正确：{$value}"],
            ]);
        }
        return (string) $value;
    }

    private static function normalizeRuleSetTag(string $value): string
    {
        $value = trim($value);
        if ($value === '' || strlen($value) > 128 || !preg_match('/^[A-Za-z0-9_!@.:+-]+$/', $value)) {
            throw ValidationException::withMessages([
                'criteria' => ["sing-box Rule Set Tag 不正确：{$value}"],
            ]);
        }
        return $value;
    }
}
