# 节点出站管理

本扩展在管理员后台的“节点管理”菜单内增加“出站管理”。它把一个
管理员维护的落地代理绑定到现有 Xboard 节点；它不是用户购买、兑换或
独享节点功能。

## 工作方式

- 一个出站资料可以授权到多个节点；一个节点可以同时拥有多个管理出站。
- 面板只在已认证的节点控制面响应中下发凭据，订阅和用户 API 不会包含。
- 节点原有的私网拦截、面板路由和自定义路由优先执行；未匹配的 TCP/UDP
  流量才走已绑定出站。
- “授权到节点”只表示节点获得该出站凭据和 Tag，不代表所有流量都使用它。
- 每个节点最多将一个已授权出站设为默认 final；未命中路由时才走该出站。
- 没有默认出站时，未命中路由的流量按普通 `direct` 配置处理。
- 所有客户端订阅、节点地址和协议均不需要修改。
- 后台列表使用服务端分页，每页 20 条，并可按名称、地址或协议搜索。
- 绑定窗口支持按名称/地址搜索、按绑定状态筛选、跨页多选和批量操作。

## 后台操作

1. 在左侧“节点管理”下打开“出站管理”，填写并保存出站资料。
2. 点击资料行的“绑定节点”，搜索并勾选一台或多台节点。
3. “授权所选”只下发凭据；“授权并设为默认”还会接管未命中路由的流量。
4. “取消默认”保留出站可用性，但不再作为 final；“撤销授权”移除凭据。
5. 面板会显示节点确认状态；节点热切换完成后再核对一次真实出口 IP。

“测试”按钮在面板容器执行代理自检；“节点探测”则把一次性
`probe.egress` 指令发送到指定节点，由节点建立隔离内核并验证真实的
`节点 → 落地代理 → 目标网站` 路径。结果包含 TCP/TLS 完成状态、端到端
延迟和出口 IP。凭据只经过已认证 WebSocket，不写入日志。最近结果按节点缓存
30 天，不记录用户目标或流量历史。

节点探测默认访问 `https://api.ipify.org?format=json`。面板自身可达、节点
不可达时不会再被误判为代理可用。

编辑出站资料会立即通知所有已授权的在线节点。节点会先创建或替换
多个 `panel-egress-*` 出站，再切换路由并清理失效出站，不会重启内核或断开
控制面 WebSocket。用户名和密码不会回显到浏览器：留空表示保留原值，
勾选“清除”才会删除已保存的凭据。

## 前端接入边界

出站管理使用与路由管理相同的薄适配层和模块边界：

```text
Xboard 官方管理 SPA
        ↓
egress-admin-adapter.js
        ↓
egress-admin.js（controller）
        ├── egress-admin-state.js
        ├── egress-admin-form.js
        ├── egress-admin-view.js
        └── egress-admin-api.js
```

官方侧栏克隆、菜单选中态、MutationObserver、历史导航、滚动容器、页面挂载、
登录令牌和请求鉴权都集中在适配器。控制器只编排保存、真实代理测试、节点绑定、
解绑、分页和配置确认流程。

业务模块不直接访问 `document`、`window` 或 `localStorage`，因此官方 SPA
更新页面结构时只需调整适配器。

## 支持的出站类型

| 类型 | 必填项 | 高级 JSON |
| --- | --- | --- |
| SOCKS5 | 主机、端口；可选用户名/密码 | `{}` |
| HTTP / HTTPS | 主机、端口；可选用户名/密码 | 勾选 TLS/HTTPS 时可填写 SNI |
| Shadowsocks | 主机、端口、密码 | `{ "method": "aes-256-gcm" }` |
| VLESS | 主机、端口 | `{ "uuid": "...", "flow": "xtls-rprx-vision" }` |
| Trojan | 主机、端口、密码 | `{}` |

VLESS Reality 出站在高级 JSON 增加：

```json
{
  "uuid": "00000000-0000-0000-0000-000000000000",
  "flow": "xtls-rprx-vision",
  "network": "tcp",
  "reality": {
    "public_key": "PUBLIC_KEY",
    "short_id": "0123456789abcdef"
  }
}
```

同时填写 TLS SNI。Reality 的私钥只属于远端落地服务器，不应填入本面板。

保存时会校验 VLESS UUID、Shadowsocks 加密方式、Reality public key /
short ID / TLS SNI，以及各协议要求的密码。IPv6 地址可以填写裸地址，
也可以在粘贴时使用方括号；后端保存前会自动去掉方括号。

VLESS/Trojan 高级 JSON 还支持：

```json
{
  "network": "ws",
  "path": "/gateway",
  "host": "cdn.example.com",
  "service_name": "grpc-service"
}
```

可用的 `network` 为 `tcp`、`ws`、`grpc`、`http`、`httpupgrade`。Reality
目前只允许 `tcp`，VLESS `flow` 只允许 `xtls-rprx-vision`。

## 部署顺序

1. 部署配套 Xboard 版本并执行 `php artisan migrate --force`。
2. 把 `v2026.10.30` 或更新版本的
   [Xboard-Node Release](https://github.com/Duan-rax/Xboard-Node/releases)
   部署到**每一台将被绑定的机器**。
3. 在后台“节点管理 → 出站管理”新建资料、选择已有节点并绑定。
4. 等待节点推送或下一次拉取配置；检查节点内核日志是否成功重载。

官方 `cedar2025/Xboard-Node` 及其他未包含本扩展的版本会安全地忽略
`egress_proxy` 字段，因此不会产生出站效果。只有部署
`Duan-rax/Xboard-Node` 的 `v2026.10.30` 或更新版本后，绑定才会真正生效。
可以让官方节点和定制节点同时连接同一面板，但只应把出站资料绑定到支持
该字段的定制节点。

## 灰度与回滚

1. 先授权一台低风险节点，并在该节点执行“节点探测”，核对出口 IP。
2. 确认节点进程 PID 未变化、控制面 WebSocket 未断开。
3. 撤销授权并确认依赖该出站的路由转为 fail-closed 阻断，其他路由不受影响。
4. 再批量绑定其他节点；每台节点升级前保留可运行的二进制备份。
5. 若节点未确认配置，检查节点版本、日志和 REST/WS 面板连接，不要反复重启
   内核来掩盖真正的配置漂移。
