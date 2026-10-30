package main

import "testing"

func TestProbeConfigUsesProtocolSpecificCredentials(t *testing.T) {
	for _, protocol := range []string{"shadowsocks", "trojan"} {
		t.Run(protocol, func(t *testing.T) {
			proxy := egressProxy{
				Protocol: protocol, Host: "proxy.test", Port: 443,
				Username: "stale-user", Password: "secret",
				Config: map[string]any{"method": "aes-256-gcm"},
			}
			outbound := probeConfig(proxy, 12345)["outbounds"].([]any)[0].(map[string]any)
			if _, exists := outbound["username"]; exists {
				t.Fatalf("%s outbound contains unsupported username: %#v", protocol, outbound)
			}
			if outbound["password"] != "secret" {
				t.Fatalf("%s password = %#v", protocol, outbound["password"])
			}
		})
	}
}

func TestProbeConfigRealityEnablesUTLS(t *testing.T) {
	proxy := egressProxy{
		Protocol: "vless", Host: "proxy.test", Port: 443, TLSServerName: "cdn.test",
		Config: map[string]any{
			"uuid": "6f0c30dc-5e98-4eb1-a52a-042ea7861e08",
			"reality": map[string]any{"public_key": "key", "short_id": "abcd"},
		},
	}
	outbound := probeConfig(proxy, 12345)["outbounds"].([]any)[0].(map[string]any)
	tls := outbound["tls"].(map[string]any)
	utls := tls["utls"].(map[string]any)
	if utls["fingerprint"] != "chrome" {
		t.Fatalf("unexpected uTLS settings: %#v", utls)
	}
}
