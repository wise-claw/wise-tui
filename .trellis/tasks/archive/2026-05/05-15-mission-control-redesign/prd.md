# Mission Control 驾驶舱重新设计 —— 全链路用户体验与引擎增强

## 1. 问题诊断（来自 05-14-mission-control-cockpit Phase A 复审）

### UI/UX 层
1. **三列信息过载**：需求卡片墙 + 任务图层 + 证据面板同时铺开，无主视线。用户不知道先看哪。
2. **子代理数据造假**：`EvidencePane.tsx:122-150` 的 `buildDispatchRows()` 硬编码三行假数据，与实际 agent 执行无关。
3. **流程叙事断裂**：phase chips（起草/规划/校验/完成）在 header 里像装饰品，不参与主视线引导。
4. **溯源链路被折叠**：PRD 锚点 + 代码锚点埋在右栏 `AnchorSection` 里，必须点击任务才能看到。
5. **"驾驶舱"隐喻缺失**：无态势感知——没有进度、风险、谁在干什么、瓶颈在哪。

### 引擎层
1. **零实时反馈**：Rust 端 `prd_split_dispatch_cluster` 用 `read_to_end` 等 Claude 完全结束后一次性返回。前端进度条固定 70%，是装饰品。
2. **错误覆盖**：多个 cluster 失败时后续错误覆盖前一个全局 error。Verifier 只跑一次，失败后永远 `failed`。
3. **无后台执行**：整个流水线绑定在 React 组件生命周期上。关闭窗口 → 运行中 Promise 丢失，无恢复机制。
4. **无 ETA / 排队信息**：`Promise.allSettled` 并行所有 cluster，用户不知道哪个快哪个慢。

### Splitter 提示词
- **一致性**：正确遵循 Trellis workflow.md 的 `Active task:` 前缀、子代理命名、输出 schema 约束。
- **偏离**：提示词主体为中文；`OUTPUT_SCHEMA.json` 引用方式有歧义（提示词说"见文件"但同时也内联了 schema）。

## 2. 产品愿景

Wise 的核心差异化不是"AI 帮你写代码"，而是**可追踪、可并行、可验证、可复盘、接近全自动的研发自动驾驶舱**。

Mission Control 是 Wise 的主入口。用户粘贴 PRD → 模型派子代理拆解需求 → 规划为任务 → 任务与 PRD 可双向溯源 → 子代理按 Trellis 工作流执行 → 可视化实现路径。用户一眼看到：哪个子代理在做哪个项目、进度如何、瓶颈在哪。

## 3. 用户故事（Phase A 修正 + Phase B 新增 = 完整版）

### 信息架构（A · 本次必做）

- **作为研发负责人**，打开 Mission Control 时第一眼看到：当前 Mission 标题、项目/仓库、清晰的大阶段进度条、子代理活动面板（谁在干什么）、主 CTA 按钮（告诉我下一步做什么）。
- **作为研发**，粘贴 PRD 并提交后，看到子代理被派发出去拆解需求——每个子代理一行，实时显示状态（思考中/生成中/等待中/完成/失败），有进度条和已用时间。
- **作为研发**，拆分完成后看到中栏"任务时间线"：每个并行组是一条泳道，任务卡片在泳道中显示标题、角色标签、优先级、仓库归属。卡片上直接显示关联的 PRD 需求编号（可点跳转）。
- **作为研发**，点一条需求 → 对应任务卡片高亮。点一个任务 → 右侧抽屉打开详情：PRD 锚点预览、代码锚点、优先级、子项/DoD 编辑。溯源链路在一条视线内。
- **作为研发**，看到瓶颈任务被自动标记（红色边框 + "瓶颈"标签），了解哪些任务卡住了整体进度。
- **作为研发**，可以关闭 Mission Control 窗口，拆分/执行在后台继续。任务完成后系统通知弹出。重新打开 Mission Control 时恢复上次会话状态。
- **作为研发**，拆分或执行失败时，失败原因以醒目的错误卡片展示（非全局覆盖），可点击查看详情（stdout/stderr 日志），可手动重试单个 cluster。

### 执行可视化（B · 后续阶段）

- **作为研发**，中栏任务时间线中的每个任务卡片实时显示其 Trellis 子代理状态（research → implement → check → verify），带阶段 chip 和当前文件指示。
- **作为研发**，看到多个子代理同时在跑不同的任务，一目了然并发态势。

### 工程细节（A · 保留现有能力）

- **作为研发**，点击"工程细节"抽屉可查看 cluster id、validation issues、原始 splitter 输出等内部信息。主屏不出现任何工程术语。

## 4. 核心设计方案

### 4.1 布局方案：主画布 + 右侧详情抽屉

```
┌─ Mission Header ─────────────────────────────────────────────────┐
│ 标题 + 阶段进度 stepper + 子代理活动摘要 + 风险 + CTA               │
├──────────────────────────────────────────────────────────────────┤
│ 左列 (PRD需求树)    │  中列 (任务时间线/泳道图)    │ [详情抽屉]    │
│ 可折叠树形，每行:   │  并行组泳道，任务卡片         │ 按需从右侧    │
│ - REQ-01 需求标题   │  显示: 标题/优先级/角色/      │ 滑出。内容:   │
│ - 关联任务数 badge  │  仓库/PRD锚点/子代理状态       │ PRD锚点预览   │
│ - 优先级/重要性标签 │  层间SVG依赖连线              │ 代码锚点列表  │
│ - 完成度百分比      │  底部: 图例 + 进度条          │ 任务编辑器    │
│                     │                               │ 工程细节折叠区│
│ 宽度: ~240px        │  宽度: flex-grow 占据剩余      │ Drawer 560px  │
└──────────────────────────────────────────────────────────────────┘
```

**与旧版的区别**：
- 右栏从常驻面板改为按需抽屉 → 减少信息密度
- 左列从大卡片改为紧凑树形 → 更多需求可见
- 中列保留泳道图但卡片上**直接显示子代理状态和 PRD 锚点** → 溯源就在一条视线上
- Header 增强为真正的事态摘要 → 子代理活动、进度条、风险计数

### 4.2 实时反馈机制

**Rust 端改造**：`prd_split_dispatch_cluster` 不再用 `read_to_end`，改为**逐行读取 stdout 并 emit Tauri 事件**：

```
claude -p <prompt> ... → stdout 逐行 → Tauri event "splitter:stdout-line"
                                         ↓
                              前端 useEffect 监听 → 更新进度面板
```

同时保留 `read_to_end` 作为完整结果兜底。

事件 payload：
```json
{
  "clusterId": "abc",
  "line": "...",
  "timestampMs": 1700000000
}
```

前端解析关键行（如 `Active task:`、`{ "tasks": ...` 出现）驱动进度条和状态文案。

**进度条不再固定 70%**，改为分段推进：
- 0-20%：Claude 启动中
- 20-80%：stdout 输出中（根据输出行数 vs 预估）
- 80-100%：JSON 提取 + 校验中

### 4.3 后台执行

**Rust 端**：新增 `prd_split_dispatch_cluster_background` 命令：
- 接收相同输入
- spawn 独立 Tokio task（`tokio::spawn`），不 await
- 返回 `run_id` 给前端
- 运行时通过 Tauri events 推送进度
- 完成后写入 `run_dir/run-result.json`
- 前端组件卸载不影响后台 task

**前端**：
- `MissionRunStore`（React context）管理运行中 mission 列表
- 从 localStorage/`~/.wise/` 恢复之前的运行状态
- 关闭窗口后重开 → 读取 `prd-runs/` 目录 → 恢复运行状态

### 4.4 错误处理兜底

- **Per-cluster 错误独立**：每个 cluster 有自己的 error 字段，不再覆盖全局 error
- **错误面板**：失败的 cluster 显示红色错误卡片，含错误摘要 + 展开按钮（查看完整 stdout/stderr）
- **手动重试**：失败 cluster 旁有"重试"按钮，调用 `dispatchClusterSplit` 重跑
- **Verifier 自动重试**：verifier 失败后自动重试 1 次（间隔 2s），仍然失败再标记 `blocked`

### 4.5 Splitter 提示词修正

- 提示词主体改为**英文**，与 Trellis workflow.md 子代理派发协议一致
- `OUTPUT_SCHEMA.json` 的引用方式统一：prompt 中说"见 input bundle 中的 OUTPUT_SCHEMA.json 文件"，不在 prompt 中内联完整 schema
- 默认模型约束：通过 `--model` 参数传入（沿用现有 CLI 参数机制）

## 5. 范围 / 不做

### 本期做（Phase A 修正）

1. 重新设计主布局（左树 + 中泳道 + 右抽屉）
2. Header 增强：子代理活动摘要、真实进度条、阶段 stepper
3. Rust 端 stdout 流式推送 Tauri events
4. 前端实时进度面板（解析关键行）
5. 后台执行支持（Rust spawn + 前端 run store）
6. Per-cluster 错误独立 + 错误详情面板 + 手动重试
7. Splitter 提示词改英文、OUTPUT_SCHEMA 引用修正
8. 任务卡片上直接显示 PRD 锚点 tag + 优先级标签
9. 子代理活动面板接入真实数据（非 mock）

### 后续做（Phase B · 独立任务）

- 任务卡片接入 Trellis agent 实时执行状态（research/implement/check/verify）
- 多 agent 并发执行看板
- 证据采集（git diff、测试结果、截图、agent 输出）
- Trellis 状态自动回写

### 不做

- 不改 Tauri 其他后端命令
- 不动 workflow graph 数据 schema
- 不动 `useSplitWizardState` action/reducer 行为（只做读侧投影）
- 不引入额外 UI 框架
- 不做暗黑模式

## 6. 验收标准

### 视觉与信息架构
- [ ] 打开 Mission Control → 主屏：Header + 左树 + 中泳道。无右栏常驻面板。
- [ ] Header 显示：使命标题、项目/仓库、4 阶段 stepper（当前阶段高亮）、子代理活动摘要（运行中 N 个/完成 N 个）、风险计数、主 CTA。
- [ ] 左列需求树：每行显示 ID、标题摘要、关联任务数 badge、完成度圆环。点击高亮对应任务。
- [ ] 中列任务泳道：并行组虚线框、依赖连线（SVG）、任务卡片（标题/优先级 tag/角色 tag/仓库 tag/PRD 锚点 tag/子代理状态 chip）。
- [ ] 点击任务 → 右侧抽屉滑出：PRD 锚点预览 + 代码锚点列表 + 编辑入口 + 工程细节折叠。
- [ ] 主屏不出现 cluster/dirty/validation/verifier/parentTaskName 等工程术语。

### 实时反馈
- [ ] 拆分过程中进度条分段推进（非固定值），显示当前阶段文案（"Claude 启动中…"/"生成任务中…"/"校验结果中…"）。
- [ ] 每个 cluster 的运行时状态（等待/运行中/完成/失败）实时更新。
- [ ] 运行时间显示（已用秒数，每秒刷新）。

### 后台执行
- [ ] 关闭 Mission Control 窗口 → 拆分继续在后台运行。
- [ ] 重新打开 → 恢复上次运行状态（读取 prd-runs 目录）。
- [ ] 运行完成 → 系统通知（Tauri notification）。

### 错误处理
- [ ] 单个 cluster 失败不覆盖其他 cluster 状态。
- [ ] 失败 cluster 显示错误摘要卡，可展开查看完整日志。
- [ ] 失败 cluster 可手动重试。

### 工程
- [ ] `bun test` 通过。
- [ ] `bunx tsc --noEmit` 通过。
- [ ] 旧 `PrdSplitWizardModal` 不被任何业务路径打开。
- [ ] 已有测试不被破坏。

## 7. 已确认决策

1. **主布局**：左需求树 + 中泳道 + 右详情抽屉（Drawer 560px）。不改常驻面板。
2. **阶段 stepper**：使用大号 Ant Design `Steps` 组件替代圆角 chips，当前阶段高亮、已完成打勾。
3. **视觉风格**：整体由设计驱动，避免暗黑模式，一眼看到子代理活动。
4. **Phase B 接入**：本期至少接入 splitter stdout 流做子代理状态 0→1。完整多 agent 看板后续独立任务。
