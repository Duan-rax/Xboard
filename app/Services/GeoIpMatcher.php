<?php

namespace App\Services;

final class GeoIpMatcher
{
    public function __construct(private readonly mixed $lookup = null)
    {
    }

    /**
     * Supports the GeoIP forms used by the route UI. Unknown country codes
     * remain indeterminate rather than producing a false match.
     */
    public function matchesAny(array $codes, string $ip): ?bool
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return null;
        }

        $private = !filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
        if ($private) {
            return in_array('private', array_map(
                fn ($code) => strtolower(trim((string) $code)),
                $codes
            ), true);
        }
        $country = $this->country($ip);
        $checked = false;
        foreach ($codes as $code) {
            $code = strtolower(trim((string) $code));
            if ($code === 'private') {
                $checked = true;
                continue;
            }
            if ($code === 'cn') {
                if ($country === null) {
                    continue;
                }
                $checked = true;
                if ($country === 'cn') {
                    return true;
                }
                continue;
            }
            if ($code === '!cn') {
                if ($country === null) {
                    continue;
                }
                $checked = true;
                if ($country !== 'cn') {
                    return true;
                }
            }
        }
        return $checked ? false : null;
    }

    private function country(string $ip): ?string
    {
        if ($this->lookup !== null) {
            try {
                $country = ($this->lookup)($ip);
                return is_string($country) && trim($country) !== ''
                    ? strtolower(trim($country))
                    : null;
            } catch (\Throwable) {
                return null;
            }
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return null;
        }

        try {
            $region = (new \Ip2Region())->memorySearch($ip)['region'] ?? '';
            $country = trim(explode('|', (string) $region, 2)[0]);
            return match ($country) {
                '中国', 'China', 'CN' => 'cn',
                '' => null,
                default => strtolower($country),
            };
        } catch (\Throwable) {
            return null;
        }
    }
}
