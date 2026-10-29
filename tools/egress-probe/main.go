package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	singJSON "github.com/sagernet/sing/common/json"
)

const (
	defaultTarget = "https://api.ipify.org?format=json"
	probeTimeout  = 12 * time.Second
)

type egressProxy struct {
	ID            int            `json:"id"`
	Protocol      string         `json:"protocol"`
	Host          string         `json:"host"`
	Port          int            `json:"port"`
	Username      string         `json:"username"`
	Password      string         `json:"password"`
	TLSEnabled    bool           `json:"tls_enabled"`
	TLSServerName string         `json:"tls_server_name"`
	AllowInsecure bool           `json:"allow_insecure"`
	Config        map[string]any `json:"config"`
}

type result struct {
	OK        bool   `json:"ok"`
	LatencyMS int64  `json:"latency_ms"`
	Message   string `json:"message"`
	ExitIP    string `json:"exit_ip,omitempty"`
	Target    string `json:"target"`
}

func main() {
	var proxy egressProxy
	if err := json.NewDecoder(os.Stdin).Decode(&proxy); err != nil {
		emit(result{OK: false, Message: "读取代理配置失败: " + err.Error()})
		os.Exit(1)
	}
	if err := validate(proxy); err != nil {
		emit(result{OK: false, Message: err.Error()})
		os.Exit(1)
	}

	target := strings.TrimSpace(os.Getenv("EGRESS_PROBE_TARGET"))
	if target == "" {
		target = defaultTarget
	}
	probeResult := probe(proxy, target)
	emit(probeResult)
	if !probeResult.OK {
		os.Exit(1)
	}
}

func validate(proxy egressProxy) error {
	if strings.TrimSpace(proxy.Host) == "" || proxy.Port < 1 || proxy.Port > 65535 {
		return fmt.Errorf("代理地址或端口无效")
	}
	switch strings.ToLower(proxy.Protocol) {
	case "socks5", "http", "shadowsocks", "vless", "trojan":
		return nil
	default:
		return fmt.Errorf("不支持的代理协议: %s", proxy.Protocol)
	}
}

func probe(proxy egressProxy, target string) result {
	port, err := freePort()
	if err != nil {
		return result{OK: false, Message: "无法分配本地测试端口: " + err.Error(), Target: target}
	}

	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	ctx = include.Context(ctx)
	config := probeConfig(proxy, port)
	data, err := json.Marshal(config)
	if err != nil {
		return result{OK: false, Message: "生成代理测试配置失败: " + err.Error(), Target: target}
	}
	opts, err := singJSON.UnmarshalExtendedContext[option.Options](ctx, data)
	if err != nil {
		return result{OK: false, Message: "解析代理测试配置失败: " + err.Error(), Target: target}
	}
	instance, err := box.New(box.Options{Context: ctx, Options: opts})
	if err != nil {
		return result{OK: false, Message: "创建代理内核失败: " + err.Error(), Target: target}
	}
	if err := instance.Start(); err != nil {
		_ = instance.Close()
		return result{OK: false, Message: "启动代理内核失败: " + err.Error(), Target: target}
	}
	defer instance.Close()

	proxyURL := &url.URL{
		Scheme: "socks5",
		Host:   net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyURL(proxyURL),
		ForceAttemptHTTP2:     true,
		DisableKeepAlives:     true,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
	}
	client := &http.Client{Transport: transport, Timeout: probeTimeout}
	started := time.Now()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return result{OK: false, Message: "创建测试请求失败: " + err.Error(), Target: target}
	}
	request.Header.Set("User-Agent", "Xboard-Egress-Probe/1.0")
	response, err := client.Do(request)
	if err != nil {
		return result{
			OK:        false,
			LatencyMS: time.Since(started).Milliseconds(),
			Message:   "代理请求失败: " + compactError(err),
			Target:    target,
		}
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 4096))
	if readErr != nil {
		return result{OK: false, Message: "读取代理响应失败: " + readErr.Error(), Target: target}
	}
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return result{
			OK:        false,
			LatencyMS: time.Since(started).Milliseconds(),
			Message:   fmt.Sprintf("代理响应异常（HTTP %d）", response.StatusCode),
			Target:    target,
		}
	}

	latency := time.Since(started).Milliseconds()
	exitIP := parseExitIP(body)
	message := fmt.Sprintf("真实代理可用（%d ms）", latency)
	if exitIP != "" {
		message += "，出口 IP " + exitIP
	}
	return result{
		OK:        true,
		LatencyMS: latency,
		Message:   message,
		ExitIP:    exitIP,
		Target:    target,
	}
}

func probeConfig(proxy egressProxy, port int) map[string]any {
	protocol := strings.ToLower(proxy.Protocol)
	tag := "egress-probe-out"
	outbound := map[string]any{
		"type":        singboxType(protocol),
		"tag":         tag,
		"server":      proxy.Host,
		"server_port": proxy.Port,
	}
	switch protocol {
	case "socks5":
		outbound["version"] = "5"
	case "shadowsocks":
		outbound["method"] = stringValue(proxy.Config, "method")
	case "vless":
		outbound["uuid"] = stringValue(proxy.Config, "uuid")
		if flow := stringValue(proxy.Config, "flow"); flow != "" {
			outbound["flow"] = flow
		}
	}
	if proxy.Username != "" {
		outbound["username"] = proxy.Username
	}
	if proxy.Password != "" {
		outbound["password"] = proxy.Password
	}
	if tls := tlsConfig(proxy); tls != nil {
		outbound["tls"] = tls
	}

	return map[string]any{
		"log": map[string]any{"level": "error", "timestamp": false},
		"inbounds": []any{
			map[string]any{
				"type":        "mixed",
				"tag":         "egress-probe-in",
				"listen":      "127.0.0.1",
				"listen_port": port,
			},
		},
		"outbounds": []any{
			outbound,
			map[string]any{"type": "direct", "tag": "direct"},
		},
		"route": map[string]any{"final": tag},
	}
}

func singboxType(protocol string) string {
	switch protocol {
	case "socks5":
		return "socks"
	case "http":
		return "http"
	default:
		return protocol
	}
}

func tlsConfig(proxy egressProxy) map[string]any {
	reality, _ := proxy.Config["reality"].(map[string]any)
	if !proxy.TLSEnabled && reality == nil {
		return nil
	}
	tls := map[string]any{"enabled": true, "insecure": proxy.AllowInsecure}
	serverName := proxy.TLSServerName
	if serverName == "" {
		serverName = stringValue(proxy.Config, "server_name")
	}
	if serverName != "" {
		tls["server_name"] = serverName
	}
	if reality != nil {
		tls["reality"] = map[string]any{
			"enabled":    true,
			"public_key": reality["public_key"],
			"short_id":   reality["short_id"],
		}
	}
	return tls
}

func stringValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func parseExitIP(body []byte) string {
	var payload struct {
		IP string `json:"ip"`
	}
	if json.Unmarshal(body, &payload) == nil && net.ParseIP(payload.IP) != nil {
		return payload.IP
	}
	return ""
}

func compactError(err error) string {
	message := strings.ReplaceAll(err.Error(), "\n", " ")
	if len(message) > 300 {
		return message[:300] + "…"
	}
	return message
}

func emit(value result) {
	_ = json.NewEncoder(os.Stdout).Encode(value)
}
