# Mission Control 研发驾驶舱（PRD→任务→执行→证据 全链路重构）

## 1. 背景

现有 `PrdSplitWizardModal`（4 步向导 + done 页 `PrdTraceMap`）功能已通：
PRD → 任务分组 → 生成任务 → 审阅与调整 → 写入 Trellis → 生成 workflow graph。

但它停留在「把所有内部状态摆出来」的工程面板形态：

- 三列卡片墙没有主视线；规划/执行/溯源三层平铺，叙事不清。
- 并行只是一个 Tag，看不出"谁卡住谁、瓶颈在哪"。
- 溯源是次级信息，PRD↔代码 两端链路被埋在卡片底部。
- `cluster / dirty / unchanged / parentTaskName / validation / verifier / workflowId / run_dir` 等工程语词大量泄露到用户文案。
- 整个体验被 Modal 框住，无法与 Claude 主会话、监控、文件预览共存。

## 2. 产品愿景

Wise 的核心差异化不是"AI 帮你写代码"，而是 **可追踪、可并行、可验证、可复盘的研发自动驾驶舱**。
本任务把"需求拆分"这一最高频入口，升级为 **Mission Control**：研发使命从 PRD 到执行的全链路可视化。

一屏看清楚：

- 当前 Mission 的目标与总进度
- 每条 PRD 需求拆出了哪些任务
- 任务之间的依赖与可并行组（谁先跑、谁能同时跑、谁卡住谁）
- 当前选中任务的 PRD 来源段落、对应代码锚点、（未来）实时执行与证据
- 一键复用历史父任务 / 接入执行编排

## 3. 用户故事（Phase A 范围）

- **作为研发负责人**，打开 Mission Control 时一眼看清当前 Mission 的目标、进度阶段（规划/编排/执行/验证）、风险点，主 CTA 永远告诉我"下一步该做什么"。
- **作为研发**，左栏点一条需求，中栏立刻高亮它拆出的所有任务（包括跨并行层、跨仓位），右栏自动展示这条需求的 PRD 锚点与已识别的代码锚点。
- **作为研发**，看到中栏的"并行层"是粗虚线框 + 醒目标题"可并行 · 4 个任务"，相邻两层之间有视觉连接线（依赖箭头），瓶颈层（任务最多/阻塞）会高亮。
- **作为研发**，点任意任务卡片，右栏抽屉式打开它的详情：标题/角色/PRD 锚点/代码锚点（可点跳转）/状态/复用历史/写入路径。常用操作（改标题、改锚点、加子项、删任务、加任务）就在这里。
- **作为研发**，工程性细节（cluster id、validation issue 列表、原始 splitter 输出、dirty 原因、workflow id、run_dir 等）默认隐藏，需要时点 Header 右上"高级 · 工程细节"在抽屉打开；不再污染主视线。
- **作为研发**，Mission Control 与 Claude 会话、监控、文件预览同居一屋——它是 App 的一个一级模式（与 MCP/技能/知识图谱并列），左栏不被覆盖。

## 4. 范围 / 不做

### Phase A（本任务必须完成）

包含：

- 新顶层组件 `src/components/MissionControl/`：Mission Header + 三列主画布 + 两个抽屉（Setup / 工程细节）。
- Mission 状态机：以"使命阶段"`drafting | planning | executing | verifying | done` 替代 wizard 的 `input | plan | dispatch | review | writing | done`，作为 user-facing 状态。底层 stage 字段保留为引擎实现细节。
- **复用 `useSplitWizardState` reducer 与 `services/prdSplit/*` 服务一字不改**，新建表现层在其上封装一层 `useMissionPresenter()`，把 `WizardState` 投影为 Mission Control 需要的 ViewModel。
- 选择模型：单一主选中（需求或任务），驱动中栏高亮 + 右栏证据。
- 用户态执行状态收敛为 5 个：`等待 / 准备中 / 执行中 / 已完成 / 已阻塞`；内部 7 状态保留在工程抽屉。
- 杀掉 `PrdSplitWizardModal` 的 Modal 主入口：把 `PrdSplitWizardHost` 改为路由到 Mission Control（`missionControlMode` 模式开关 + AppWorkspaceLayout 的全宽分支）。FAB 行为不变。
- 词汇表：用户面文案完全去除以下词（保留在工程抽屉/dev console）：
  cluster, dirty, unchanged, validation, verifier, normalized, parentTaskName, repoId, workflowId, run_dir, primary repo, reassign, splitter, trellis-splitter, textHash, oldHash, normalizer。
  外加新建中文文案表替换。
- 至少保留以下既有能力（接入新表现层，不必复刻原 UI）：
  PRD 输入与历史导入、目标项目/仓库切换、参与仓位选择、cluster 调整（用"任务分组"措辞）、生成任务、审阅与编辑、PRD 锚点编辑、写入 Trellis、生成 workflow graph、打开执行编排、复用历史父任务、跳过无变化分组。
- 删除/迁移现有 `PrdSplitWizard/stages/*` 中**不再需要**的 UI 代码；保留 1-2 个高复杂度子组件（`AnchorViewerModal`、`ListEditor`）作为 Mission Control 内部组件复用。
- 测试：核心 `useMissionPresenter` 投影函数（vitest/bun test）；ViewModel 在不同 `WizardState` 下的快照测试。
- 不依赖任何后端新增；现有 Tauri 命令不动。

### Phase B（**后续任务**，本任务不做）

- 多 Agent 实时执行看板：把 task 卡片接入 `research / implement / check / verifier` 子代理生命周期，实时显示阶段、耗时、当前文件。
- 证据采集：每个任务关联其 git diff / 测试结果 / 截图 / 错误日志 / agent 输出。
- Trellis 状态自动回写：从执行结果反向更新 `task.json` 状态与 `code_anchors`。
- 完全替换 `ReviewStage` 内的 1146 行编辑组件为 Mission Control 原生编辑面板。

### 显式不做（Out of Scope）

- 不改 Tauri 后端命令、不改 `prd_split_pipeline.rs`。
- 不动 workflow graph 数据 schema（`buildPrdSplitWorkflowArtifacts` 与 trace preview 模型保持兼容）。
- 不动 `useSplitWizardState` 的 Action 与 reducer 行为（只做读侧投影）。
- 不引入额外 UI 框架；只用 Ant Design + 现有 CSS 变量。
- 不做国际化（中文文案直写）。

## 5. 验收标准

### 视觉与信息架构

- [ ] 打开 Mission Control 后，主屏分三层：顶部 Mission Header、中部三列画布、底部无干扰；其中**任务图谱列在视觉上为主角**（宽度最大、信息密度最高、色彩最重）。
- [ ] Mission Header 显示：使命标题（来自 PRD 第一句话或目标项目名）、所属项目/仓库、4 阶段进度指示（高亮当前阶段）、风险计数（阻塞任务数 / 校验异常数）、主 CTA 按钮（根据阶段切换文案）。
- [ ] 三列从左到右：`PRD 需求 / 任务图谱与并行编排 / 详情与证据`。中列任务图谱按并行层垂直堆叠，每个并行层是带"可并行 · N"标签的粗虚线容器；单任务层不画虚线。
- [ ] 左列点一条需求 → 中列对应任务卡片立即高亮（背景色 + 描边变色）；其他任务保持显示但降透明度（≥0.4），不消失。
- [ ] 中列点一个任务 → 右列证据面板更新；任务卡片显示选中态描边；其依赖链以连接线高亮（包括上游/下游）。
- [ ] 右列证据面板内容顺序：标题 + 状态 chip → PRD 锚点（含"在 PRD 中查看"按钮，打开 AnchorViewerModal）→ 代码锚点列表（点击 dispatch `WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE`）→ 编辑操作（改标题、改子项、改 DoD、加/删任务）→ 折叠区"工程细节"（cluster id、parentTaskName、taskPath、validation issues）。
- [ ] 主画布**不出现**第 4 节词汇表所列任何内部术语；它们只出现在工程细节抽屉 / 折叠区。

### 流程

- [ ] 全新使命：Mission Header 显示"起草 Mission"，主 CTA = "粘贴 PRD 开始"；点击打开 Setup Drawer（包含目标项目/仓库切换、参与仓位、PRD 文本编辑器、从历史 PRD 导入）。
- [ ] Setup Drawer 提交后自动 `parseAndPlan`；成功进入 `planning` 阶段，中列展示任务图谱（可能还未生成任务，先展示分组与每组的预估任务数；待生成后填充真实任务）。
- [ ] 主 CTA 文案随阶段切换：`粘贴 PRD 开始 → 生成任务 → 落盘到 Trellis → 打开执行编排`。
- [ ] 任意时刻可重打开 Setup Drawer 修改 PRD/目标（与现有 `backToInput` 等价，附确认弹窗）。
- [ ] 写入 Trellis 完成后，使命进入 `done` 阶段，Mission Header 显示"使命已落盘"，主 CTA = "打开执行编排"，触发原 `WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG` 事件。

### 工程

- [ ] `bun test` 通过；新增至少 1 个针对 `useMissionPresenter`（或等价投影模块）的测试文件。
- [ ] 旧的 `PrdSplitWizardModal` 不再被任何业务路径打开；其文件可保留但 export 路径中加 `@deprecated` 注释，由 Phase B 删除。所有原来调用 `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` 的路径都自动跳转到 Mission Control。
- [ ] 任务 `useSplitWizardState.test.ts`、`clusterPlanEdits.test.ts`、`workflowGraphFromSplit.test.ts` 等已有测试 **不被破坏**。
- [ ] 左栏 Sidebar 不被 Mission Control 覆盖（满足现有 `.app-full-width-main` 模式约束）。

## 6. 关键非功能约束

- **性能**：选中切换 / hover 高亮必须在 60fps；任务卡片数 ≤ 200 时主画布首屏 < 200ms。Drawer 懒加载。
- **可拓展**：每个任务卡片的视图模型预留 `executionState` 与 `evidence` 字段（Phase A 留空），方便 Phase B 一行接通。
- **可测**：所有 `WizardState → MissionViewModel` 投影逻辑放纯函数模块，可断言。
- **可还原**：保留 `PrdSplitWizardModal` 源码与导出 1 个版本周期（Phase B 任务负责删除），出现严重回归可临时切回。

## 7. 成功指标（产品级）

- 首屏即能识别"当前 Mission 在哪一阶段、瓶颈在哪、下一步做什么"。
- 用户在 Mission Control 内完成一次"PRD → 落盘"的平均点击数下降（与现 wizard 对比基线）。
- 工程性术语在主画布的可见次数 = 0（grep 检查通过）。
