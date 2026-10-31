# 路由管理 2.0

## 目标

路由规则负责“哪些流量使用哪个动作”，出站管理负责“落地代理是什么”。
两者保持独立：

- 直连、阻止和按条件分流属于路由管理。
- SOCKS5、HTTP、Shadowsocks、VLESS 和 Trojan 落地资料属于出站管理。
- `custom_config` 仅保留为高级兼容层。

## 匹配条件

- 精确域名：只匹配填写的完整域名。
- 域名后缀：匹配该域名及其子域名。
- 域名关键字：匹配域名中的固定片段。
- 域名正则：使用 Xray/sing-box 共有的 RE2 兼容语法。
- IP/CIDR：IPv4、IPv6 和 CIDR。
- 目标端口：单端口或 `8000-8100` 范围。
- 网络：`tcp` 或 `udp`。
- 来源 IP/CIDR。
- 来源端口。
- 嗅探协议：`http`、`tls`、`quic` 或 `bittorrent`。

多个值之间按换行或逗号分隔，同一类条件内部为 OR。
CIDR 会归一到网络地址，IPv6 使用标准压缩形式；域名会去尾点并转换 IDN 为
Punycode，确保语义相同的条件得到同一个配置哈希。

单字段最多 1000 个值，单条规则最多 2000 个匹配值，展开后最多 200 条内核
规则。预览会显示 `any` 模式的实际展开数量，避免生成过大的配置。

域名和嗅探协议依赖流量嗅探。节点只在规则实际需要时开启嗅探，
IP/端口规则不会额外等待嗅探超时。加密或混淆后的 BT 流量仍可能无法识别。

## 组合方式

- `any`：不同匹配类别生成多条 OR 规则，任一条件命中即执行动作。
- `all`：生成一个同时满足所有已填写条件的规则。

实际优先级为：

1. 结构化自定义规则。
2. 高级原始路由。
3. 私网安全拦截。
4. 面板路由，按优先级从小到大。
5. 节点绑定落地出站。
6. 默认直连。

## 动作

- `direct`：直接使用节点本地网络。
- `block`：阻止连接。
- `proxy`：转发到指定自定义出站 Tag。
- `dns`：交给 DNS 出站处理，可指定目标 Tag。

出站 Tag 建议列表来自所有节点的自定义出站，以及已定义的
`panel-egress-*` 资料。规则通过 `route_ids` 绑定到节点，不会修改用户订阅。

## 兼容与升级

迁移只新增 `criteria`、`match_mode`、`priority`、`enabled` 字段，不改写
已有 `match` 数据。旧节点会忽略新增字段；结构化规则需要配套
`Xboard-Node` 路由 2.0 版本。

升级顺序：

1. 先升级将使用结构化规则的节点。
2. 部署面板并执行 `php artisan migrate --force`。
3. 选择一台低风险节点绑定规则并执行预览、保存。
4. 检查节点日志和实际流量，再扩大绑定范围。

## 配置确认

面板为每个节点生成 `config_revision` 与稳定的 `config_hash`。节点应用配置后
通过状态上报原样返回两个值；路由页面只有收到相同 revision 和 hash 才显示
已确认。

- `config_revision` 在协议、路由、出站、证书和绑定变化时递增。
- `config_hash` 是规范化节点控制配置的 SHA-256，不包含生成时间。
- 旧节点不返回新字段时会保持“等待确认”，不会产生假成功。
- 路由保存后页面自动轮询绑定节点的确认结果。

## 节点能力协商

节点会在状态上报中提供实际编译进二进制的内核版本和路由能力：

```json
{
  "kernel": "sing-box",
  "kernel_version": "v1.14.0-alpha.2-...",
  "features": [
    "structured_routes",
    "domain_exact",
    "domain_suffix",
    "ip_cidr",
    "geoip",
    "geosite",
    "rule_set"
  ]
}
```

面板按照规则实际使用的条件校验节点能力。例如 `rule_sets` 只能绑定到
sing-box，`source_port`、`domain_regex` 和 `dns_action` 也需要节点明确上报
对应能力。已知不兼容的绑定会在服务端被拒绝；旧节点尚未上报能力时显示
“能力待上报”，升级后下一次状态上报会自动生效。

在绑定节点页面可以看到内核、版本、能力数量和兼容结果。规则列表和预览也会
报告已绑定节点中的能力冲突。

## 路由模拟器

页面底部可直接选择节点并输入域名/IP、解析 IP、端口、TCP/UDP、来源 IP 和
嗅探协议。模拟器按该节点实际绑定的规则顺序返回：

- 确定命中或可能命中的第一条规则。
- 规则优先级、动作、最终出站和展开规则标签。
- 被首条命中规则遮蔽的后续规则。
- 每一类条件是否命中或无法由面板判断。
- 未命中规则时的节点托管出站或 `direct` 默认出口。

GeoIP、GeoSite 和 Rule Set 依赖节点下载的数据库，模拟器会标记为
“可能命中”，不会把未知结果伪装成确定命中。节点本地 `custom_routes` 优先于
面板规则，页面也会提示模拟结果的边界。

Xray 节点可增加：

```yaml
kernel:
  type: xray
  domain_strategy: "IPIfNonMatch"
```

可选值为 `AsIs`、`IPIfNonMatch`、`IPOnDemand`。需要让域名先解析再匹配
IP/CIDR 时使用 `IPIfNonMatch`；节点状态会把实际策略上报给面板。

## 内置规则模板

路由页面提供三个幂等模板：

- 广告、统计与遥测：合并 `category-ads-all` 和
  `category-ads-and-telemetry`，保持为一条阻断规则。
- BitTorrent、BT/PT 与 Tracker：合并 `bittorrent` 协议嗅探、
  `category-pt@!cn`、BT 客户端、公开 Tracker 和站点域名。
- AI 服务走管理出站：合并 OpenAI、ChatGPT、Anthropic、Claude、Gemini、
  Mistral、Perplexity、Hugging Face 等常见域名。

模板使用 `preset_key` 识别，不会按名称猜测并反复创建副本。广告和 BT 模板
会合并所有匹配旧规则的节点绑定；AI 模板只绑定到当前使用所选管理出站的
节点，避免目标 `panel-egress-*` 在未绑定该出站的节点上失效。

把规则绑定到使用管理出站的节点时，可以直接选择“自动授权但不设为默认”。
节点因此获得 `panel-egress-*` 出站供路由匹配，未命中的流量仍使用原 final。
若出站后来被停用或撤销授权，面板会把该节点的目标规则转换成 `block`，
确保配置保持有效并执行 fail-closed，而不会意外直连。

## 前端接入边界

路由页面通过薄适配层接入官方后台：

```text
Xboard 官方管理 SPA
        ↓
route-admin-adapter.js
        ↓
route-admin.js（controller）
        ├── route-admin-state.js
        ├── route-admin-form.js
        ├── route-admin-diagnostics.js
        ├── route-admin-view.js
        └── route-admin-api.js
```

`route-admin-adapter.js` 只负责官方侧栏、菜单选中态、历史路由、页面挂载、
登录令牌和 API 请求封装。`route-admin.js` 不再直接访问 `document`、`window`
或 `localStorage`，只负责事件编排和工作流。

这样官方 SPA 更新 DOM 或菜单结构时，只需调整适配层；后续可以继续把
各业务模块独立测试和调整。当前控制器保持在约 350 行，避免再次形成单个
近千行的运行时代码文件。

## 后续路线

1. 在节点规模达到约 500–1000 台后，再将 `route_ids` 迁移到关联绑定表。
2. 按需增加多出站组、健康成员切换和权重策略。

## 灰度检查

- 规则保存后面板不应跳回页面顶部。
- 节点能力、内核版本和兼容结果显示应与实际内核一致。
- 节点应热重载路由，不重启内核。
- `all` 规则必须生成单个多字段条件，而不是多个 OR 规则。
- sing-box 的 GeoIP/GeoSite 必须编译为远程 `rule_set`，不得生成已移除的
  `geoip`/`geosite` 旧字段。
- 停用规则后不得继续命中。
- 旧路由在新版本和回退节点上都应保持可用。
