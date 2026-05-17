# Mission Control 驾驶舱重新设计 —— 实施计划

## 总体节奏

六步推进："Rust 实时流 → 数据层重写 → 组件树重建 → 抽屉与交互 → 接入 AppImpl → 验证与清理"。

每步完成后跑 `bun test && bunx tsc --noEmit`。

⚠️ 严禁 AI 启动 `bun run tauri:dev` / `bun run dev`。可视化由用户验收。

---

## Step 1 · Rust 端实时流与后台执行

**目标**：让前端在拆分过程中收到实时进度事件。

- [ ] 修改 `src-tauri/src/claude_commands/prd_split_pipeline.rs`：
  - `prd_split_dispatch_cluster` 增加 `app: tauri::AppHandle` 参数
  - stdout 读取从 `read_to_end` 改为 `BufReader::lines()` 逐行
  - 每行 emit `splitter:output:{clusterId}` 事件（payload: `{ line, timestampMs }`）
  - 检测到 `{` 开头行 emit `splitter:progress:{clusterId}` 事件 (kind: "json-detected")
  - 开始/完成时 emit `splitter:progress:{clusterId}` (kind: "started"/"completed")
  - 保留 `read_to_end` 完整输出的兜底路径
- [ ] 新增 `prd_split_dispatch_cluster_background` 命令：
  - 参数同 `prd_split_dispatch_cluster` + `app: tauri::AppHandle`
  - spawn `tokio::spawn` 独立 task，不 await
  - 返回 `{ run_id, run_dir }`
  - task 内通过 `app.emit()` 推送进度
  - 完成后写入 `run_dir/run-result.json`
- [ ] 在 `src-tauri/src/lib.rs` 注册新命令
- [ ] 超时保护：`tokio::select!` 同时等 line 和 timeout（每行 30s 无输出则超时）

**验证**：
```bash
cd src-tauri && cargo check
```

**回退点**：Rust 改动独立于前端；git revert 此 commit 即回退。

---

## Step 2 · 前端数据层重写

**目标**：新 ViewModel + 实时状态模型 + Tauri event 监听。

- [ ] `presenter/types.ts`：按 design §3.1 新增/修改类型：
  - `MissionRunState / ClusterRunProgress / ClusterError`
  - `RequirementTreeNodeVM`（替代 `RequirementCardVM`）
  - `SwimlaneVM`（替代 `ParallelLayerVM`）
  - `TaskCardVM` 增加 `priority / prdAnchorTags / agentStatus`
  - `TaskDetailVM`（替代 `TaskEvidenceVM`）
  - 保留 `TaskEvidenceVM` 旧名作为 alias 兼容旧组件
- [ ] `presenter/projectMission.ts`：
  - 新增 `buildRequirementTree()` 从 requirementsIndex 构建树形（支持父子层级）
  - 新增 `buildTaskSwimlane()` 替代 `buildLayers()`
  - 新增 `deriveRunState()` 从 `clusterRuns` 投影实时状态
  - `buildTaskCards` 增加 `priority` 推导（从 requirement 数量/依赖数/角色推断）
  - `buildSelectedTaskDetail` 替代 `buildSelectedTaskEvidence`
  - 保留旧投影函数名作 alias
- [ ] `presenter/projectMission.test.ts`：更新 fixture 覆盖新投影
  - 空 state → 空树 + 空泳道
  - PRD 已解析 → 3 条需求树 + 2 层泳道
  - 部分 dispatch → runState.phase="dispatching"，clusters 有进度
  - 写入完成 → phase=done
- [ ] `useMissionPresenter.ts`：适配新 ViewModel 结构
- [ ] `useSplitterStream.ts`：新增 hook
  - `listen("splitter:output:*")` 逐行消费
  - 解析关键行驱动进度条（"Active task:"→20%, "{"→80%, "tasks"→90%）
  - 节流更新（`requestAnimationFrame` 合并，最多 30fps）
  - 返回 `{ clusterProgressMap }`
- [ ] `useMissionRunStore.ts`：新增 hook
  - 挂载时扫描 `~/.wise/prd-runs/` 恢复后台运行状态
  - 管理 `backgroundRuns: Map<string, BackgroundRunState>`
  - 监听 `splitter:complete:*` 事件 → 发送 Tauri notification
- [ ] `actions/runMissionActions.ts`：
  - `runMissionClusters` 改为调用 `prd_split_dispatch_cluster_background`（支持后台）
  - 新增 `retryCluster(clusterId)` 函数
  - 新增 `cancelClusterRun(clusterId)` 函数
- [ ] `useSplitWizardState.ts`：新增 `patchClusterProgress` action（仅内存）

**验证**：
```bash
bun test src/components/MissionControl/presenter/
bunx tsc --noEmit -p tsconfig.json
```

**回退点**：类型和纯函数在 `presenter/` 内；删除目录即回滚。

---

## Step 3 · 组件树重建（主画布 + Header）

**目标**：新布局组件树可渲染，消费新 ViewModel，但未挂载到 App。

- [ ] `header/MissionHeader.tsx`：重写
  - 左侧：标题 + subtitle
  - 中部：Ant Design `Steps` 组件（4 步：起草/规划/校验/完成），`current` 绑定 `phaseStrip`
  - 右侧：`MissionAgentSummary` + `MissionRiskBadge` + 主 CTA + 工程细节按钮 + 关闭按钮
- [ ] `header/MissionAgentSummary.tsx`：新增
  - 显示运行中/完成/失败的子代理计数（chip 样式）
  - 点击可展开下拉列表
- [ ] `header/MissionProgressBar.tsx`：新增
  - 真实分段进度条：分段颜色（等待/运行中/成功/失败）
  - 百分比 + 阶段文案
- [ ] `canvas/MissionCanvas.tsx`：重写
  - 布局：左 `RequirementsTree` + 中 `TaskSwimlane`
  - 无右栏常驻面板
- [ ] `canvas/RequirementsTree.tsx`：新增
  - 使用 Ant Design `Tree` 组件
  - 每节点：需求 ID + 标题摘要 + 任务数 badge + 完成度圆环 + 优先级 tag
  - `onSelect` → `setSelection({ requirementId })`
  - 支持搜索/过滤
- [ ] `canvas/RequirementTreeNode.tsx`：新增
  - 树节点渲染：title（含 badge）+ icon
- [ ] `canvas/TaskSwimlane.tsx`：新增
  - 按泳道层垂直堆叠
  - 每层间 `DependencyConnector` SVG 连线
  - 底部 `SwimlaneLegend` 图例
- [ ] `canvas/TaskSwimlaneLayer.tsx`：新增
  - 并行层：虚线框 + "可并行 · N 个任务" 标题 + 瓶颈标签
  - 单任务层：实线框
  - 任务卡片 grid 布局
- [ ] `canvas/TaskCard.tsx`：重写
  - 顶部：任务 ID + 状态 chip
  - 中部：标题（2 行截断）
  - 底部标签行：优先级 tag（P0 红色/P1 橙色/P2 灰色）+ 角色 tag + 仓库 tag
  - 下方：PRD 锚点 tag（可点 → 打开 PRD 锚点抽屉）+ 子代理状态 chip
  - 选中态/高亮态/dimmed 态（沿用现有 CSS 类名）
- [ ] `canvas/SwimlaneLegend.tsx`：新增
  - 图例：已完成/进行中/队列/阻塞 + 优先级含义
- [ ] `MissionControl.tsx`：重写顶层
  - 整合 `useSplitWizardState` + `useMissionPresenter` + `useSplitterStream` + `useMissionRunStore`
  - 管理 `selection` / `setupOpen` / `engineeringOpen` / `detailDrawerOpen` state
  - props 接口保持兼容

**验证**：
```bash
bun test
bunx tsc --noEmit -p tsconfig.json
```

**回退点**：新组件在 `MissionControl/` 内；未挂载到 App，删除即回滚。

---

## Step 4 · 详情抽屉与交互

- [ ] `details/TaskDetailDrawer.tsx`：新增
  - Drawer 560px 宽，`push` 模式（不覆盖内容）
  - 打开时显示：任务标题 + 状态 chip → PRD 锚点区 → 代码锚点列表 → 编辑区 → 工程细节折叠
  - 关闭按钮 + "在 PRD 中查看" 按钮
- [ ] `details/AnchorSection.tsx`：重构适配新数据
- [ ] `details/TaskEditorInline.tsx`：重构适配新数据
- [ ] `details/EngineeringFoldout.tsx`：保留
- [ ] `canvas/TaskCard.tsx`：点击 → `setSelection + setDetailDrawerOpen(true)`
- [ ] `canvas/RequirementsTree.tsx`：右键菜单"移动需求到其他分组"（复用旧逻辑）
- [ ] Header "重新粘贴 PRD" 入口保留

**验证**：
```bash
bun test
bunx tsc --noEmit
```

---

## Step 5 · 接入 AppImpl + 切换主入口

**目标**：Mission Control V2 成为主入口，旧 V1 退役。

- [ ] `src/constants/workflowUiEvents.ts`：确保 `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 常量存在
- [ ] `src/AppImpl.tsx`：
  - `missionControlMode` state → 渲染 `MissionControl`（V2）
  - 移除旧 `PrdSplitWizardModal` mount
  - 监听事件路由不变
- [ ] `src/components/AppWorkspaceLayout.tsx`：`missionControlMode` 分支不变（已有）
- [ ] `src/components/PrdSplitWizard/Host.tsx`：FAB 点击 dispatch `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`
- [ ] `src/components/PrdSplitWizard/index.ts`：
  - 导出 `MissionControl` from `../MissionControl`
  - 旧 `PrdSplitWizardModal` 标记 `@deprecated`，保留文件
- [ ] 删除旧 `MissionControl/` 中被替换的组件（RequirementsColumn / TaskGraphColumn / ParallelLayerBlock / EvidencePane / RequirementCard）

**手动验证清单**：
1. FAB → Mission Control 全屏，左 Sidebar 不被遮挡
2. 首次打开自动弹 Setup Drawer
3. 粘贴 PRD → 进入 planning，左树显示需求，中泳道显示分组
4. 点需求 → 对应任务高亮
5. 点任务 → 右侧抽屉滑出（PRD 锚点 + 代码锚点 + 编辑）
6. 主 CTA 生成任务 → 进度条分段推进（非固定 70%），子代理摘要实时更新
7. 落盘 → done 阶段，CTA = "打开执行编排"
8. 关闭 Mission Control → 后台继续运行，通知弹出
9. 重开 → 恢复上次运行状态

**回退点**：AppImpl 中 feature flag 切回旧 `missionControlMode` 分支。≤ 5 行。

---

## Step 6 · Splitter 提示词修正 + 词汇巡查 + 最终验证

- [ ] `src/services/prdSplit/splitterDispatch.ts`：
  - `composeSplitterPrompt()` 提示词主体改为英文
  - OUTPUT_SCHEMA 引用改为 "see OUTPUT_SCHEMA.json in the input bundle"（不内联完整 schema）
  - 保留 `Active task:` 第一行
- [ ] 词汇巡查：
  ```bash
  grep -rnE "\b(cluster|Cluster|dirty|unchanged|validation|verifier|normalized|parentTaskName|repoId|workflowId|run_dir|splitter|trellis-splitter|textHash)\b" src/components/MissionControl/header src/components/MissionControl/canvas src/components/MissionControl/details
  ```
  期望为空（js 标识符允许，JSX 文案不允许）
- [ ] `bun test` 全量
- [ ] `bunx tsc --noEmit` 全量
- [ ] grep 旧入口：确认除 deprecated 文件外无 `PrdSplitWizardModal` 消费方
- [ ] 更新 `.trellis/spec/frontend/index.md` 中指向旧 wizard 的引用（若有）

---

## 关键风险与缓解

| 风险 | 缓解 |
|---|---|
| Rust `BufReader::lines()` 阻塞无换行 | `tokio::select!` 加 30s 行超时 |
| Tauri events 洪泛前端 | `requestAnimationFrame` throttle，30fps 上限 |
| 后台 task 关闭窗口后 AppHandle 失效 | Tauri AppHandle 独立于窗口生命周期，可安全 clone 持有 |
| 旧测试断言旧组件结构 | 旧组件文件 `_legacy/` 目录保留；新组件不碰旧测试 |
| 提示词改英文影响 split 质量 | 保留中文版 prompt 为 fallback；A/B 对比后切换 |

## 顺序总结

1. Step 1：Rust 实时流（~80 行改动）
2. Step 2：前端数据层（~400 行新代码 + 测试）
3. Step 3：组件树（~800 行新 JSX/CSS）
4. Step 4：抽屉与交互（~300 行）
5. Step 5：接入 AppImpl（~30 行改动）
6. Step 6：提示词修正 + 清理（~50 行）

预计净增 ~1400 行，修改 ~200 行，删除旧组件 ~600 行。
