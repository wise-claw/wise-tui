# 指挥台（Command Surface）

本目录存放 Wise **三栏指挥台** 的产品与工程方案：左栏索引工作区、中栏持久指挥、右栏上下文透镜；执行下沉到仓库/Assignment，**AskUserQuestion / Permission / Blocker 等关口统一回传中栏处理**。

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构定稿（v3）：概念模型、三栏职责、FocusContext、主路径、与宪法关系 |
| [EXECUTION-PLAN.md](./EXECUTION-PLAN.md) | 分周交付计划、验收标准、模块改动清单 |
| [API-CONTRACT.md](./API-CONTRACT.md) | `gateHub` / `dispatchIntent` / `FocusContext` 类型与 API 草案 |
| [prototype/index.html](./prototype/index.html) | **可交互 UI 原型**（三栏 + GateBar + WorkItemFeed + 透镜联动） |

## 与现有文档的关系

- **产品宪法**：`.trellis/spec/guides/agent-harness-architecture.md` — Operator / Author / Inspector 三域；本方案细化 Operator 域的中栏指挥台与 Inspector 右栏透镜，实施前应先更新宪法 §3–§4。
- **已有能力**：`notificationHub`、`mission_runs` / `mission_agent_assignments`、`trellis_runtime_events`、`atMentionDispatch` — 本方案**扩展而非替换**。
- **演进记录**：v1（三栏 + 回传收件箱）→ v2（Command Thread + Action Queue）→ **v3（WorkItem / Gate + 对齐现有表 + 分周落地）**；以 ARCHITECTURE.md 为准。

## 一句话定位

> 中栏是调度台：WorkItemFeed 看全局进度，GateBar 处理「要我做什么」，CommandBar 下达意图；执行在 Assignment 里跑，关口一律回中栏；右栏跟 FocusContext 走，只提供上下文。
