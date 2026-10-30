# 安全审计

安全审计是 Xboard 原生一级后台模块，不再依赖 `RiskAudit` 插件。

## 功能

安全审计在后台侧栏中包含五个小分类：

| 分类 | 内容 |
| --- | --- |
| 审计概览 | 总流量、上传、下载、连接、阻断、热门目标和节点分布 |
| 流量明细 | 按用户、节点、目标域名和动作筛选连接事件 |
| 规则命中 | 按面板规则汇总连接、流量、动作、出站和最近命中时间 |
| 用户审计 | 按用户汇总流量和阻断，并钻取该用户的连接明细 |
| 审计设置 | 上报地址、HMAC Secret、保留期限和过期数据清理 |

## 数据表

- `v2_traffic_audit_events`

事件包含稳定的 `route_id`、`route_tag`、`route_source`、`action` 和
`outbound`。旧插件表 `v2_risk_audit_events` 不再作为新功能的写入目标。

## 节点上报

采集器上报地址：

```text
/api/v1/traffic-audit/events
```

支持两种认证：

```text
X-Audit-Token: <secret>
```

或：

```text
X-Audit-Timestamp: <unix timestamp>
X-Audit-Signature: HMAC-SHA256(timestamp + "." + body, secret)
```

Secret 在“安全审计 → 审计接收设置”中生成或修改。事件使用 `event_id`
幂等写入，采集器重试不会产生重复记录。

## 内核差异

- sing-box 通过本机 Clash API 采集每个连接的目标、上传、下载、规则和出站，
  并从 Xboard-Node 的数字化用户审计日志关联面板用户 ID。
- Xray 通过访问日志采集目标、来源、用户 ID 和连接数。Xray 访问日志不包含
  每连接字节计数和出站 Tag，因此这些字段显示为空，不会使用估算值伪造。
- 审计概览、用户和节点的累计流量读取 Xboard 原有 `v2_stat_user` 与
  `v2_stat_server`。Xray 的内置 StatsService 累计计数已经用于这些总额，
  但无法把用户级累计值可靠分摊到某一条连接或某个目标域名。

机器管理页面生成的一键安装命令会使用 fork 的 GitHub Release installer。
新服务器会自动获取审计引导配置、安装对应架构的采集器，并以 machine token
认证。已有 machine 中新增的逻辑节点会通过 manifest 自动进入审计；Xray
节点按节点 ID 使用独立访问日志文件。

## 数据保留

默认保留 30 天，每天 03:19 自动清理过期事件。可在审计设置中调整为
1–365 天。

审计只保存连接元数据，不保存正文、URL 路径、账号密码或 TLS 内容。
