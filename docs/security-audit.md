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

## 数据保留

默认保留 30 天，每天 03:19 自动清理过期事件。可在审计设置中调整为
1–365 天。

审计只保存连接元数据，不保存正文、URL 路径、账号密码或 TLS 内容。
