<?php

namespace App\Services;

class NodeCapabilityService
{
    public const CRITERION_FEATURES = [
        'domains' => 'domain_exact',
        'domain_suffixes' => 'domain_suffix',
        'domain_keywords' => 'domain_keyword',
        'domain_regexes' => 'domain_regex',
        'ip_cidrs' => 'ip_cidr',
        'ports' => 'port',
        'networks' => 'network',
        'source_cidrs' => 'source_ip',
        'source_ports' => 'source_port',
        'protocols' => 'protocol_sniff',
        'geoip' => 'geoip',
        'geosite' => 'geosite',
        'rule_sets' => 'rule_set',
    ];

    public static function fromMetrics(?array $metrics): array
    {
        $kernel = trim((string) ($metrics['kernel'] ?? ''));
        $version = trim((string) ($metrics['kernel_version'] ?? ''));
        $domainStrategy = trim((string) ($metrics['domain_strategy'] ?? ''));
        $rawFeatures = $metrics['features'] ?? null;
        $features = [];
        if (is_array($rawFeatures)) {
            foreach ($rawFeatures as $feature) {
                if (!is_string($feature)) {
                    continue;
                }
                $feature = strtolower(trim($feature));
                if ($feature !== '' && strlen($feature) <= 80) {
                    $features[$feature] = true;
                }
            }
        }
        $features = array_keys($features);
        sort($features, SORT_STRING);

        return [
            'known' => $kernel !== '' && is_array($rawFeatures),
            'kernel' => $kernel,
            'kernel_version' => $version,
            'domain_strategy' => $domainStrategy,
            'features' => $features,
        ];
    }

    public static function evaluate(
        ?array $criteria,
        string $action,
        string $matchMode,
        array $capabilities
    ): array {
        if (!($capabilities['known'] ?? false)) {
            return [
                'supported' => null,
                'known' => false,
                'missing_features' => [],
                'message' => '节点尚未上报内核能力，升级 Node 后会自动校验。',
            ];
        }

        $required = self::requiredFeatures($criteria, $action, $matchMode);
        $available = array_fill_keys($capabilities['features'] ?? [], true);
        $missing = array_values(array_filter(
            $required,
            fn ($feature) => !isset($available[$feature])
        ));

        return [
            'supported' => $missing === [],
            'known' => true,
            'missing_features' => $missing,
            'message' => $missing === []
                ? '当前规则与节点内核能力兼容。'
                : '节点不支持：' . implode(', ', $missing),
        ];
    }

    public static function requiredFeatures(
        ?array $criteria,
        string $action,
        string $matchMode
    ): array {
        $features = [];
        if (RouteRuleValidator::hasCriteria($criteria)) {
            $features[] = 'structured_routes';
            $features[] = $matchMode === 'all' ? 'match_all' : 'match_any';
        }
        foreach (self::CRITERION_FEATURES as $criterion => $feature) {
            if (!empty($criteria[$criterion])) {
                $features[] = $feature;
            }
        }
        if ($action === 'dns') {
            $features[] = 'dns_action';
        }
        return array_values(array_unique($features));
    }
}
