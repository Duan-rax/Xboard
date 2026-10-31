<?php

namespace App\Services;

/**
 * Pure validation helpers for administrator-managed egress profiles.
 *
 * Kept free of framework dependencies so the rules can be unit tested without
 * bootstrapping the application (the same constraint as the node-config test).
 */
class EgressProxyValidator
{
    public const PROTOCOLS = ['socks5', 'http', 'shadowsocks', 'vless', 'trojan'];

    /**
     * Returns Laravel-style validation errors keyed by request field.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, array<int, string>>
     */
    public static function errors(
        string $protocol,
        array $config,
        ?string $password,
        ?string $tlsServerName = null
    ): array
    {
        $errors = [];

        switch ($protocol) {
            case 'shadowsocks':
                $method = trim((string) ($config['method'] ?? ''));
                if ($method === '') {
                    $errors['config.method'] = ['Shadowsocks 出站必须填写加密方式（config.method）。'];
                } elseif (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/', $method)) {
                    $errors['config.method'] = ['Shadowsocks 加密方式格式不正确。'];
                }
                if (trim((string) $password) === '') {
                    $errors['password'] = ['Shadowsocks 出站必须填写密码。'];
                }
                break;

            case 'vless':
                $uuid = trim((string) ($config['uuid'] ?? ''));
                if ($uuid === '') {
                    $errors['config.uuid'] = ['VLESS 出站必须填写 UUID（config.uuid）。'];
                } elseif (!preg_match(
                    '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/',
                    $uuid
                )) {
                    $errors['config.uuid'] = ['VLESS UUID 必须是标准 36 位格式，例如 00000000-0000-0000-0000-000000000000。'];
                }
                $flow = strtolower(trim((string) ($config['flow'] ?? '')));
                if ($flow !== '' && $flow !== 'xtls-rprx-vision') {
                    $errors['config.flow'] = ['VLESS flow 仅支持 xtls-rprx-vision。'];
                }
                break;

            case 'trojan':
                if (trim((string) $password) === '') {
                    $errors['password'] = ['Trojan 出站必须填写密码。'];
                }
                break;
        }

        $network = strtolower(trim((string) ($config['network'] ?? '')));
        if ($network === '') {
            $network = 'tcp';
        }
        if ($network === 'websocket') {
            $network = 'ws';
        }
        if (!in_array($network, ['tcp', 'ws', 'grpc', 'http', 'httpupgrade'], true)) {
            $errors['config.network'] = ['出站传输网络只支持 tcp、ws、grpc、http 或 httpupgrade。'];
        } elseif ($network !== 'tcp' && !in_array($protocol, ['vless', 'trojan'], true)) {
            $errors['config.network'] = ['只有 VLESS 或 Trojan 出站可以使用非 TCP 传输。'];
        }

        $reality = $config['reality'] ?? null;
        if (is_array($reality) && $reality !== []) {
            if (trim((string) ($reality['public_key'] ?? '')) === '') {
                $errors['config.reality.public_key'] = ['Reality 出站必须填写 public_key。'];
            }
            if (trim((string) $tlsServerName) === '') {
                $errors['tls_server_name'] = ['Reality 出站必须填写 TLS SNI。'];
            }
            $shortId = trim((string) ($reality['short_id'] ?? ''));
            if ($shortId === '') {
                $errors['config.reality.short_id'] = ['Reality 出站必须填写 short_id。'];
            } elseif (!preg_match('/^(?:[0-9a-fA-F]{2}){1,8}$/', $shortId)) {
                $errors['config.reality.short_id'] = ['Reality short_id 必须是 2-16 位、长度为偶数的十六进制字符。'];
            }
            if ($network !== 'tcp') {
                $errors['config.network'] = ['Reality 出站目前只支持 tcp 传输。'];
            }
        }

        return $errors;
    }

    /**
     * Trim every scalar string in the nested config while preserving types.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    public static function normalizeConfig(array $config): array
    {
        foreach ($config as $key => $value) {
            if (is_string($value)) {
                $config[$key] = trim($value);
            } elseif (is_array($value)) {
                $config[$key] = self::normalizeConfig($value);
            }
        }

        return $config;
    }
}
