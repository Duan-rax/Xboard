<?php

namespace Tests\Unit\Services;

use App\Services\EgressProxyValidator;
use PHPUnit\Framework\TestCase;

class EgressProxyValidatorTest extends TestCase
{
    public function test_protocol_specific_credentials_are_required(): void
    {
        $shadowsocks = EgressProxyValidator::errors('shadowsocks', [], null);
        $this->assertArrayHasKey('config.method', $shadowsocks);
        $this->assertArrayHasKey('password', $shadowsocks);

        $trojan = EgressProxyValidator::errors('trojan', [], '');
        $this->assertArrayHasKey('password', $trojan);

        $this->assertSame([], EgressProxyValidator::errors('socks5', [], null));
    }

    public function test_vless_uuid_must_be_standard_format(): void
    {
        $invalid = EgressProxyValidator::errors('vless', ['uuid' => 'not-a-uuid'], null);
        $this->assertArrayHasKey('config.uuid', $invalid);

        $valid = EgressProxyValidator::errors(
            'vless',
            ['uuid' => '6f0c30dc-5e98-4eb1-a52a-042ea7861e08'],
            null
        );
        $this->assertSame([], $valid);

		$oddLength = EgressProxyValidator::errors(
			'vless',
			[
				'uuid' => '6f0c30dc-5e98-4eb1-a52a-042ea7861e08',
				'reality' => ['public_key' => 'public-key', 'short_id' => 'abc'],
			],
			null,
			'cdn.example.test'
		);
		$this->assertArrayHasKey('config.reality.short_id', $oddLength);
    }

    public function test_reality_requires_public_key_short_id_and_server_name(): void
    {
        $errors = EgressProxyValidator::errors(
            'vless',
            [
                'uuid' => '6f0c30dc-5e98-4eb1-a52a-042ea7861e08',
                'reality' => ['public_key' => '', 'short_id' => 'not-hex'],
            ],
            null
        );

        $this->assertArrayHasKey('config.reality.public_key', $errors);
        $this->assertArrayHasKey('config.reality.short_id', $errors);
        $this->assertArrayHasKey('tls_server_name', $errors);

        $valid = EgressProxyValidator::errors(
            'vless',
            [
                'uuid' => '6f0c30dc-5e98-4eb1-a52a-042ea7861e08',
                'reality' => ['public_key' => 'public-key', 'short_id' => '0123456789abcdef'],
            ],
            null,
            'cdn.example.test'
        );
        $this->assertSame([], $valid);
    }

    public function test_nested_config_is_trimmed_without_changing_scalar_types(): void
    {
        $normalized = EgressProxyValidator::normalizeConfig([
            'uuid' => ' 6f0c30dc-5e98-4eb1-a52a-042ea7861e08 ',
            'enabled' => true,
            'reality' => [
                'public_key' => ' key ',
                'short_id' => ' 0123 ',
            ],
        ]);

        $this->assertSame('6f0c30dc-5e98-4eb1-a52a-042ea7861e08', $normalized['uuid']);
        $this->assertTrue($normalized['enabled']);
        $this->assertSame('key', $normalized['reality']['public_key']);
        $this->assertSame('0123', $normalized['reality']['short_id']);
    }
}
