<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

class RouteRuleValidator
{
    public const CRITERIA_KEYS = [
        'domains',
        'domain_suffixes',
        'ip_cidrs',
        'ports',
        'networks',
        'source_cidrs',
        'source_ports',
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

    public static function assertUsable(?array $criteria, array $legacyMatch, string $action, ?string $target): void
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
    }

    private static function normalizeValues(mixed $values): array
    {
        if (is_string($values)) {
            $values = preg_split('/[\r\n,]+/', $values) ?: [];
        }
        if (!is_array($values)) {
            return [];
        }
        return array_values(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $values
        ), fn ($value) => $value !== ''));
    }

    private static function normalizeDomain(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('#^[a-z]+://#i', '', $value);
        $value = rtrim((string) $value, '.');
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
        return $prefix === null ? $ip : "{$ip}/{$prefix}";
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
}
