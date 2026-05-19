# Assistant Hub: built-in PRD-split assistant + user-created assistants

## Goal

把 Wise 的"需求拆分(Mission Control)"从"项目 FAB 触发的全屏黑盒"反转为 AionUI 风格的**助手宿主**:

- 内置一个不可删除的"需求拆分助手";用户只能改它的提示词、挂载 skill / MCP,不能删除/改 engine。
- 用户可创建自己的助手(已存在 custom 通道,需复用)。
- 项目作为可绑定资源在助手内部选择,而不是反过来"项目 → mission control"。
- 把当前散落在 splitterDispatch/verifierDispatch/clusterDispatchContext 中的提示词层,变成可见、可编辑的模板。

## 用户价值

- 用户在一个统一的"助手"心智下使用 Wise,既支持研发拆分,也支持未来的写作/审查等内置助手与自建助手。
- 提示词不再是黑盒;用户能看到子代理派发用的系统提示词,并按需修改。
- 项目是助手的"运行上下文",不再绑死入口。

## 已确认事实(来自仓库)

### 助手相关代码已经存在(在 Author 域)
- `src/types/assistant.ts`:`AssistantEntry { source: "builtin" | "custom" | "extension", engineId, model, systemPrompt, customId?, extensionId?, ... }`。
- `src-tauri/migrations/026_assistant_custom.sql`:`assistant_custom` 表(id/name/description/avatar_color/engine_id/system_prompt/model/...)。
- `src-tauri/src/assistants/commands.rs`:`assistants_list / assistants_save_custom / assistants_delete_custom / assistants_get_system_prompt`,目前只内置一个 `builtin:default-claude`("默认助手 (Claude)"),系统提示词硬编码在 `BUILTIN_DEFAULT_SYSTEM_PROMPT`。
- `src/components/AssistantsPanel/index.tsx`:Author 域里的助手模板管理 UI(列表/编辑/删除/筛选 builtin/custom/extension)。
- `src/services/assistants.ts`:对应 IPC 封装。
- 扩展贡献的助手通过 `ExtensionRegistry::assistants()` 注入,系统提示词走 `assistants_get_system_prompt` 懒加载文件路径。

### Mission Control / PRD split 现状
- 入口:`src/AppImpl.tsx` 通过 `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` / `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 接收 `OpenMissionControlDetail { projectId? | repositoryId? }`,从项目/仓库的 FAB 触发,进入 `viewMode.kind = "cockpit"`。
- `src/components/MissionControl/MissionControl.tsx`:full-screen,接收 `initialTarget`,内部三栏(PRD 编辑器 → 任务泳道 → engineering/anchor/detail drawer)。
- 拆分管线:`src/services/prdSplit/{splitterDispatch,verifierDispatch,clusterDispatchContext,clusterPlanner,trellisWriter,...}`。提示词被 `splitterDispatch.ts` / `verifierDispatch.ts` 黑盒包住,用户当前看不到也改不了。
- 双写契约:`mission_runs / mission_agent_assignments / trellis_agent_runs / trellis_runtime_events`(见宪法 §5)。

### 产品宪法约束(`agent-harness-architecture.md`)
- §3 顶层 ViewMode = `cockpit | chat | author | inspect`,禁止再加新的 mode 布尔。
- §2.2 Author 域已包含"助手模板"菜单(由 `AssistantsPanel` 承接);助手是 Author 域的供给项,不是主屏。
- §4 默认主屏是 Cockpit。Chat 是子模式。
- §7 P3 要求"侧栏只有 Workspace 树,导航集中在顶栏齿轮"。

## 关键设计张力(待用户决策)

1. **助手页 UX 形态**:AionUI 截图是"标题 + 描述 + 输入框 + 示例 prompts"的轻量页;现 Mission Control 是三栏向导。需要决定 PRD-split 助手页是 (a) 先一个 AionUI 式入口页(填 PRD/选项目)→ 提交后切换到现 Mission Control 三栏继续后续流程,还是 (b) 直接把 Mission Control 三栏套上"助手 Header(描述 + 编辑提示词 + 模型 + 权限)"。
2. **入口位置**:宪法严格禁止新增侧栏顶级入口。助手列表/Hub 页放在哪里——Cockpit 的 PRD Empty State?Author Drawer 的"助手"Tab 内"打开"按钮?新的 ViewMode kind?
3. **项目绑定语义**:1 个助手对话实例 ↔ 1 个 Workspace?助手层一直显式选择项目?还是"打开 Workspace 后默认选中需求拆分助手"?
4. **可编辑提示词的范围**:只有"对话级 system prompt"?还是包含 splitter / verifier 子代理派发模板?后者改起来会动到 `splitterDispatch.ts` 等 prompt 拼装链。
5. **Skill / MCP 挂载语义**:助手层覆盖项目层?并集?还是助手只是声明"建议挂载",运行时仍走项目层?
6. **数据迁移**:存量 `mission_runs / mission_agent_assignments` 是否要回填一个"由内置 PRD-split 助手发起"的引用,还是只对新数据生效?

## Requirements(初稿,待逐题确认后细化)

- [ ] 在 `assistants_list` 中新增第二个 builtin: `builtin:prd-split`,带可被覆盖的提示词模板。
- [ ] 新增 `builtin:prd-split` 的可编辑覆盖层(系统提示词、splitter 提示词、verifier 提示词、挂载 skills/MCPs);存储在 `assistant_overrides` 类似的新表,builtin 不可删除但可重置。
- [ ] 助手页(可路由/可作为 ViewMode 的一种或 cockpit 的子状态),包含:标题/描述/可编辑、关联项目选择器、模型/权限/挂载按钮、PRD 输入或文件上传、示例 prompts。
- [ ] PRD-split 助手页提交后接续现有 Mission Control 三栏流程(不重写 splitter / verifier / trellisWriter)。
- [ ] 移除项目/仓库 FAB 上"直达 Mission Control"的 entry,改为"在助手中打开"。
- [ ] 提示词派发改为从助手覆盖层读取,默认值即现状 hardcode 提示词。

## Acceptance Criteria(初稿)

- [ ] 用户从助手 Hub(或 Author Drawer)点击"需求拆分"打开助手页;助手页能选择/绑定一个 Workspace 项目。
- [ ] 用户可在助手页内编辑系统提示词与子代理派发提示词,并能"重置为默认"。
- [ ] PRD 提交后进入现 Mission Control 任务泳道,所有现有功能(splitter/verifier/dispatch/trellis 写入/双写)行为不变。
- [ ] 内置"需求拆分助手"不能被删除;custom 助手仍可创建/删除。
- [ ] `mission_agent_assignments / trellis_agent_runs` 写入时记录所发起的 assistant_id(如 `builtin:prd-split` 或 `custom:<id>`),便于审计/回放。
- [ ] 旧入口(项目 FAB → Mission Control)行为已迁移,不留下两个入口同时存在的歧义。

## Out of Scope(初稿)

- 重写 PRD split 引擎(splitterDispatch / verifierDispatch / clusterPlanner)。本任务只做"宿主反转 + 提示词可见 + 可挂载"。
- 助手"市场/在线分发"。
- 把 Chat 也改成"必须先选助手"。Chat 默认仍可走 `builtin:default-claude`。

## Decisions(逐题收敛中)

- **D1 入口位置 = Cockpit 子态(选项 A)**。`viewMode.kind = "cockpit"` 内部新增三态切换:
  - `cockpit/hub` — Assistant Hub(默认主屏空态,卡片网格 + AionUI 风格输入条)。
  - `cockpit/assistant` — 单个助手页(描述、提示词/模型/skill/MCP 入口、项目选择器、PRD 输入、示例 prompts)。
  - `cockpit/mission` — 既有 `MissionControl` 三栏(MissionHeader / MissionCanvas / Inspector)。
  - 三态共用同一个 `viewMode.kind = "cockpit"`,**不新增 ViewMode kind**(遵守宪法 §3)。
  - 由新组件 `CockpitSurface` 在三态间路由;现有 `MissionControl.tsx` 被它包住,作为 `cockpit/mission` 子组件。
  - 不再保留项目/仓库 FAB 直达 Mission Control 的入口;改为"在助手中打开"。

- **D2 助手页 UX = 复用 `workspaceMode` 双态(选项 C)**。
  - `workspaceMode = "overview"` 且无 active mission → AionUI 式入口页(标题 + 描述 + 关联项目选择器 + 模型/权限/挂载按钮 + PRD 输入条 + 示例 prompts)。
  - `workspaceMode = "editor"` 或存在 active mission → 既有 `MissionCanvas` + drawers。
  - 两个子态共用一个紧凑 `AssistantHeader`(始终可见),提示词编辑、skill/MCP 挂载、重置默认走 Drawer/Modal。
  - `MissionControl.tsx` 的 `overview` 空态(目前只有"导入历史 PRD / 新建 PRD"两按钮)被替换为 AionUI 入口页。

- **D3 项目绑定粒度 = 助手 Header 暴露"关联项目"selector(选项 B)**。
  - 助手 Header 永远暴露"关联项目"selector,默认值 = 当前 `activeProjectId`(左栏选中的 Workspace)。
  - 切换项目即切换该 cockpit 实例的 active 项目;已有 mission 的项目走 `useMissionLedger` 恢复;无 mission 进入 PRD 输入态。
  - Standalone Repo / 无选中:selector 显示空态 + 提示"需求拆分仅支持 Workspace,可先升格当前仓库"。
  - 提交 PRD 时把当前 active 项目作为 `mission_runs.project_id` 写入,与现状一致。

- **D4 可编辑提示词范围 = 三个 slot 的"助手层"嵌入合并链(选项 B)**。
  - 现有合并链 `platform_default → project → repository` 扩展为 `platform_default → assistant_default → assistant_user_override → project → repository`。
  - 助手 Drawer 内编辑 `prdTaskSplit / phase1 / phase2` 三个 slot 的 `systemBody / repoStrategyBody / userBody`,带"重置为默认"。
  - `builtin:prd-split` 的 `assistant_default` = 当前 `DEFAULT_SPLIT_PROMPT_*_LAYERS` 硬编码值;`assistant_user_override` 默认空。
  - `composeSplitterPrompt / composeVerifierPrompt` 调用前注入 assistant 层。
  - Author → 提示词工坊 不废弃,继续承载 project / repository 层的差异化覆盖,但默认入口从 Author 转到助手 Drawer。

- **D5 四层渐进披露(替代 Observable Trellis Runtime Backend 现状)**。
  - **L1 助手页(AionUI 极简)**:`cockpit/assistant` 在 `workspaceMode="overview"` 且无 active mission 时渲染。只露 6 件事:描述、模型、关联工作区、Skills、MCP、提示词编辑入口;PRD 输入条 + 示例 prompts。其余一切折叠。
  - **L2 任务泳道(运行态)**:`workspaceMode="editor"` 或有 active mission → 现 MissionCanvas + TaskDetailDrawer。`MissionHeader` 收紧为两行(Mission 标题 + stepper + Restart/Diagnostics)。
  - **L3 助手抽屉(高级配置)**:助手 Header 单点 ⚙ 唤起,放 per-assistant 持久化的:提示词覆盖(D4 三 slot)、Skill 挂载、MCP 挂载、Engineering 偏好(`reuseExistingParents / dispatchOnlyDirty`,从 EngineeringDrawer 上移)、历史 PRD/Mission 导入(从 LegacyRunsModal 上移)、重置为默认。
  - **L4 Inspector 透镜(只读观察)**:原 `ProjectTrellisCenter` 的"运行证据"Tab(`OnboardingChecklist / AgentOwnershipGraph / RuntimeEventFeed / SpecRevisionTimeline / WorkspaceSnapshotViewer`)与"工作流图"Tab,降级为 Inspector 叠层(`inspect/runtime-events`、`inspect/workflow-graph`、`inspect/spec-timeline`),按宪法 §2.3 临时打开看完就关。
  - Author → Trellis 规范 Tab 只保留 `SpecLibraryPanel` 的批量编辑(纯离线维护场景),不再混入运行态/观察态。

- **D6 Skill / MCP 挂载语义 = 内置 bundle ∪ 从全局池挂载到项目层(参考 AionUI)**。
  - **内置 bundle**:`builtin:prd-split` 自带一组 Wise 打包的"需求拆分专用"skill / MCP(随应用分发,manifest 形式)。这是 AionUI"助手内置 skill"的等价物,用户开箱即用,不用自己拼。
  - **从全局池挂载**:L3 助手 Drawer 提供"添加 Skill / MCP"按钮,从现有全局 Skills 列表(Author → 技能市场)/ MCP 列表(Author → MCP 工具)筛选,选中后**作为项目级挂载**存储(per-project,不是 per-assistant 全局),与现有 project skill 机制对齐。
  - **运行时合并集 = 内置 bundle ∪ 项目层挂载**。用户可以在 L3 Drawer 关闭某个内置项(override 为 disabled),也可以删除自己挂载的项。
  - 内置 bundle 不可删除,只能 disabled;custom 助手没有内置 bundle(空集起步),全靠用户挂载。
  - 这样"AionUI 简单 + 功能齐全"两端都满足:新用户什么都不配也能跑(内置就绪);高级用户可以从全局池精挑细选挂到项目上。

- **D7 旧 mission/agent run 数据迁移 = 加列不回填,NULL = 前助手时代(选项 A)**。
  - migration 给 `mission_runs / mission_agent_assignments / trellis_agent_runs` 三张表加 `assistant_id TEXT NULL`,无 default。
  - 新建 mission / dispatch 时写入 `builtin:prd-split` 或 `custom:<id>`。
  - 旧行保持 NULL,UI 上以"历史记录(早于助手机制)"展示。

## 视野扩展:助手即 Trellis Phase 1 的对话化产品(用户原话:"做这个需求助手 就是现在和你在聊天一样")

这一段不是 D 级单点决策,而是把任务范围从"宿主反转 + 提示词可见 + skill/MCP 挂载"扩展到"把 Trellis Phase 1 整段(brainstorm → research → design/implement → split)做成对话产品"。后续 D8-D12 都服务这个扩展。

- 助手页中央 = 多轮 Chat,一边对话一边产出 prd.md / design.md / implement.md。
- 拆分(splitter)只是这个对话推进到一定程度后的一个 CTA,不是入口动作。
- 一次对话 ↔ 一个 Mission ↔ 一个 Trellis 任务目录(`.trellis/tasks/MM-DD-...`)。
- 拆分出来的每个 task 必须能反向追溯到 PRD 的哪个 requirement / design 的哪段。

## Decisions(派生层,推荐已锁,等批量确认)

- **D8 对话引擎 = 内嵌 Claude 会话 + 助手系统提示词**。
  - 复用现有 ClaudeSession 基础设施,把 `assistants_get_system_prompt('builtin:prd-split')` 注入为 system prompt(`trellis-brainstorm` skill 的协议改写为助手系统提示词模板)。
  - LLM 自己驱动"问一题 → 用户答 → 改 artifact"的循环,不在前端造状态机。
  - 借助 Claude tool use 让 LLM 可以调用 `update_prd / update_design / update_implement / start_splitter` 这类前端动作;前端 wiring 与现有 Claude tool/permission 体系一致。
  - 替代方案(前端状态机驱动)被否,理由:DSL 维护成本 + 与 AionUI 心智不一致。

- **D9 Mission ↔ Conversation 等价(1:1)**。
  - 一次对话 = 一个 `mission_runs.id`。新建对话即创建 mission;关闭对话不删,可在历史里恢复。
  - `mission_events` 增加 `chat_message` 事件类型,user/assistant 消息作为事件落库,顺序由 `timestamp` 保证。
  - 不再为对话单独建一张表,避免 mission 与对话不同步。
  - 已有 `useMissionLedger` 自动恢复进度 → 切工作区时直接恢复对话上下文。

- **D10 design.md / implement.md 可视化 = 中央左 Chat / 右 Artifact 双栏**。
  - Cockpit `cockpit/assistant` 运行态布局:
    - 左侧(~50%)Chat 流(就是 D8 的内嵌 Claude 会话)。
    - 右侧(~50%)Artifact Preview,Tabs:`PRD` / `Design`(复杂任务才出现)/ `Implement`(同)/ `Tasks`(splitter 完成后出现)。
    - Artifact 默认 Markdown 渲染,可切到编辑模式;LLM 写入时高亮新增段落。
  - L1(纯空态)只渲染欢迎屏 + AionUI 风格输入条;一旦发送第一条消息就切到双栏布局,不回头。
  - L2(老的 MissionCanvas)被收纳到右栏 Tasks Tab 内,不再是独立全屏。

- **D11 Task ↔ Requirement 1:1 追溯**。
  - 复用既有字段 `sourceRequirementIds`(Splitter 已写入)。
  - UI 联动:
    - 右栏 Tasks Tab 任务卡 hover/select → PRD Tab 自动滚动并高亮对应 requirement 段落。
    - PRD Tab 里 requirement 段落右侧显示"派生任务 chip 列表",点击切到 Tasks Tab 并选中。
  - design.md / implement.md 的反向追溯按段落 anchor 实现(沿用 PRD anchor reconcile 模式)。

- **D12 Phase 1.4 "approve & start" CTA**。
  - 对话推进到 PRD(轻量任务)或 PRD+design+implement(复杂任务)就绪时,助手 Header 出现"开始任务拆分"CTA(等价于 `task.py start`)。
  - 触发后:Mission 状态 → `in_progress`;splitter 流程不变(复用 `splitterDispatch`);Tasks Tab 出现并默认选中。
  - 拆分后用户可继续在 Chat 里说"重新评估 X cluster",对话与 events 追加到同 mission。
  - 对应宪法 §5.2 阶段映射,不动 Trellis ↔ Mission 的双写契约。

## Decisions(扩张层 E1-E7,2026-05-18 锁定)

- **E1 LLM 驱动 = 真 Anthropic tool use,不用 intent fence**。
  - 在 `claudeStreamRuntime` 里加 tool dispatcher,识别 stream 中 `tool_use` block,路由到 IPC 后回写 `tool_result`。
  - 工具表(初版):`update_prd / update_design / update_implement / read_artifact / start_splitter / open_inspector / list_mcps / mount_mcp`。
  - 部分高危工具(`start_splitter / mount_mcp`)前端权限网关:首次调用要 confirm。
  - 需求拆分主能力属于 Wise 内置 Trellis workflow,不通过 `CLAUDE.md` / `.claude/skills` 注入,也不提供 `mount_skill` 作为主链路。
  - 删除 D8 中"intent fence"草案。

- **E2 删除 `Author/prompts` 与 `Author/trellis-spec` 两个 Tab**。
  - 提示词覆盖完全在 `AssistantSettingsDrawer` 完成(项目层 / 仓库层 / 助手层覆盖统一通过 Drawer 内"作用域切换"操作)。
  - Trellis 规范库迁出 Author(见 E7)。
  - `PromptsPanel` 拆解,可复用的子组件搬入 `AssistantSettingsDrawer`;`PromptsPanel` 文件本身删除。
  - `AuthorPane` 联合类型移除 `"prompts"` 与 `"trellis-spec"`。

- **E3 删除 `MissionControl.tsx` 全屏壳**。
  - 保留 `src/components/MissionControl/{canvas,details,engineering,setup,actions,header,presenter,...}` 子组件,作为 `AssistantConversationView` 的依赖。
  - `MissionHeader` 也删除;由新的 `AssistantHeader` 完全替代,渲染 mission stepper / restart / diagnostics。
  - 不存在"两个入口同时活着"的过渡态。

- **E4 事件重命名 + 无兼容 shim**。
  - 删除 `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` 与 `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`。
  - 引入 `WORKFLOW_UI_EVENT_OPEN_ASSISTANT { assistantId?, projectId?, repositoryId? }`。
  - 所有调用方在同一个 commit 内迁移。

- **E5 Conversation = Mission = Trellis Task Directory 1:1:1**。
  - 新建一次助手对话:后端原子地完成 (a) `task.py create`(或等价 Rust 实现)、(b) 写 `mission_runs` 行,共享派生 id。
  - `mission_runs` 增列:`task_dir TEXT NOT NULL`(指向 `.trellis/tasks/M-DD-<slug>`)。
  - "开始拆分"CTA(D12)= `task.py start` + `splitterDispatch`,在同一 IPC 内完成两步。
  - hub "最近对话"区直接从 `mission_runs` 列表派生。

- **E6 无 fallback 渐进迁移,新对话路径上线即就绪**。
  - 删除 implement.md 阶段 3 的"AssistantConversationView 临时 fallback 渲染旧 MissionControl"妥协。
  - 阶段 3 + 阶段 5 合并为一个大阶段:CockpitSurface + AssistantHub + AssistantConversationView + 双栏 + tool dispatcher 一并就绪;不允许半成品进 main。

- **E7 Trellis 规范库重新归属**。
  - `SpecLibraryPanel` 拆出 `ProjectTrellisCenter`(后者整体删除),两处归属:
    - **`AssistantSettingsDrawer` 的 "规范" Tab**(per-assistant × per-workspace 编辑视图)。
    - **`InspectTool { kind: "spec-library" }`**(只读速览,助手 Header 一键唤起)。
  - 不再以 Author 配置 Tab 形式存在。

## 范围扩展后的 Out of Scope(更新)

- 仍**不重写** `splitterDispatch / verifierDispatch / clusterPlanner / trellisWriter` 任一运行时逻辑;只改调用方与 prompt 合并链。
- 仍**不实现** Assistant 在线市场/分发。
- 仍**不做**多对话线索(mission ↔ conversation 1:1 是硬约束)。

## Decisions(D13 修订,2026-05-18 锁定 —— 基于用户截图反馈)

> 用户给出截图(现有 `PrdTaskSplitPanel` 真实布局):左 PRD requirements 列表 + 底部"拆分"按钮;右 拆分任务卡片 + taskAnchors 锚点;点任务 → 左侧 requirement 高亮。
> 这是表单 + 一键拆分模式,**不是**多轮对话产品。D13 撤回此前的对话化决策(D8 / D10 / D12 子段),改为表单驱动 + 助手层封装。

- **D13 ① 撤回 D8(LLM 多轮 Phase 1 驱动)**。
  - 助手层不引入 ChatPane 与 `useAssistantConversation` hook;不接 `claudeStreamRuntime` 用作"对话产品"。
  - LLM 仍被调用,**仅限**子代理派发(splitterDispatch / verifierDispatch);这是现状。
  - 真 Anthropic tool use(E1 工具表 `update_prd / update_design / update_implement / start_splitter / ...`)不实现,从范围中移除。
  - 撤销 Wave B 第 1 件(ArtifactPane 4 Tab)和第 2 件(ChatPane / 占位回复 / 真 tool use)的所有前端实现。

- **D13 ② 撤回 D10(中央左 Chat / 右 Artifact 双栏)**。
  - 助手 conversation 视图 = `AssistantHeader + PrdTaskSplitPanel`(或现 `MissionControl` 内核,取决于 Stage 5 决策);**不再**双栏。
  - PrdTaskSplitPanel 已经是截图布局:左 requirements 列表(置顶/新增/删除)+ 底部拆分按钮;右 拆分任务卡片(每张含 `taskAnchors`、生成可执行任务、内容优化、保存、可执行检测、删除)。
  - PRD / Design / Implement markdown Tab 取消;若需要查看历史拆分产物,走 Stage 4 助手 Drawer 的 History Tab。

- **D13 ③ 修订 D11(Task ↔ Requirement 追溯)**。
  - 保留追溯能力,**复用现有** `anchorReconcile.ts` 机制 + PrdTaskSplitPanel 的点选高亮;不再依赖对话视图。
  - 助手层不增加新追溯 UI。

- **D13 ④ 修订 D12(approve & start CTA)**。
  - "开始拆分"= PrdTaskSplitPanel 底部"拆分"按钮(已存在);不再依赖 LLM tool 调用。
  - 后续 Phase 1.4 `task.py start` 不再走 LLM 触发,沿用现有手动流程。

- **D13 ⑤ 修订 D5(四层渐进披露)**。
  - L1 助手页(AionUI 极简)= AssistantHub 卡片 + "选择助手 → 进入 conversation"。
  - L2 = `AssistantHeader + PrdTaskSplitPanel`(单栏,不双栏)。
  - L3 助手 Drawer(Stage 4):覆盖层 / skill / MCP / engineering / specs / history。
  - L4 Inspector 透镜(Stage 5):runtime-events / workflow-graph / spec-timeline / spec-library。
  - 四层语义保留;只有 L2 内部的对话双栏被简化为表单单栏。

- **D13 ⑥ 助手 = 配置容器,不是对话主体**。
  - 助手在本任务内只承担:
    - 选择身份(builtin:prd-split / 自建 / 扩展)
    - 提供 prompt 覆盖层(已通过 Stage 1/2 的 `assistant_overrides` + `runtime_resolver` 实现)
    - 挂载 skill / MCP(Stage 4)
    - 触发 splitter(走子代理派发,与既有路径一致)
  - 未来若需要对话型助手(如代码审查、写作),作为**新助手类型**单独立任务实现;本任务范围不包含。

- **D13 ⑦ 范围与文件回退**。
  - 删除前端文件:`ChatPane.tsx` / `ArtifactPane.tsx` / `useAssistantConversation.ts` / `missionEventChat.ts(.test)` / 相关 css。
  - 保留前端文件:`CockpitSurface/{index.tsx, AssistantHub.tsx, AssistantHeader.tsx, AssistantConversationView.tsx, index.css 顶部 hub/header 段}`、`taskArtifact.ts(.test)`(供 Stage 4 调用)、`assistantPromptLayers.ts(.test)`。
  - **后端不动**:`task_artifact.rs / mission_create_with_task / read_task_artifact / write_task_artifact / assistant_overrides / runtime_resolver` 全部保留;migration 027/028/029 全部保留。Stage 4 可能用,且无负担。
  - `AssistantConversationView` 改为渲染 `<MissionControl>` 或 `<PrdTaskSplitPanel>` 的薄封装(单栏)。

## Decisions(D14 修订,2026-05-19 锁定 —— 拆分清单与执行图之间必须有编排层)

> 用户指出核心缺口:PRD 拆分产出的是"任务清单",而 fan-out 执行需要的是"执行图(DAG)"。缺少依赖分析与编排确认层时,执行器只能把任务串行丢给主会话。

- **D14 ① 新增一等编排阶段**。
  - PRD-split 主链路改为:`PRD 拆分 → 依赖分析(DAG) → 编排确认 → Fan-out 执行 → Trellis 落盘/执行记录`。
  - "任务清单"不是执行输入;只有经过依赖分析生成的 `ExecutionPlan.waves[]` 才是执行输入。

- **D14 ② 依赖分析输出 ExecutionPlan**。
  - 数据语义:
    ```ts
    interface ExecutionPlan {
      waves: Array<{
        index: number;
        taskIds: string[];
        dependsOn: string[];
      }>;
    }
    ```
  - 初版来源复用 `TaskItem.dependencies` + 现有 `parallelGroups` / `buildParallelGroups` 拓扑分层。
  - 后续增强可由编排 agent 基于 `taskAnchors`、`sourceRefs`、文件路径、命名依赖、repo role 推断依赖,再回写 `TaskItem.dependencies`。

- **D14 ③ UI 改为"编排确认",不是单纯"执行编排预览"**。
  - `PrdTaskSplitPanel` 右侧第二视图展示完整四步:`① PRD 拆分 / ② 依赖分析 / ③ 编排确认 / ④ Fan-out 执行`。
  - 中栏展示 wave-based DAG 分层;右栏展示按波次 fan-out 的 agent 派发计划。
  - 后续交互只需要支持"合并到当前波次 / 移到下一波次 / 调整依赖",不做复杂 DAG 画布编辑。

- **D14 ④ 落盘按钮语义收紧**。
  - "落盘到 Trellis"应发生在编排确认之后,写入 task 目录时同步写入/保留依赖与 wave 信息。
  - 后续执行器按 wave fan-out:启动 wave N 的所有子代理,全部完成后触发 wave N+1。

## Decisions(D15 修订,2026-05-19 锁定 —— 需求拆分阶段也必须 fan-out)

> 用户确认:需求拆分阶段派发子代理也应该走 Claude Code fan-out。它和执行阶段 fan-out 是两层不同语义。

- **D15 ① 拆分 fan-out 是生成候选任务的并行层**。
  - 链路:`PRD → cluster planner → 多个 trellis-splitter 子代理并行 → verifier/merge → 候选任务清单`。
  - 每个 splitter 子代理只负责一个 cluster / repo / domain slice,输出结构化 JSON。
  - 拆分 fan-out 的产物是候选任务、requirement 映射、task anchors、初始 dependencies、dependencyRationale。

- **D15 ② 编排 fan-out 是分析执行图的并行层**。
  - 链路:`候选任务清单 → dependency/orchestration reviewers → DAG/waves → 人工确认`。
  - 它消费 splitter 输出的初始 dependencies 与 dependencyRationale,必要时补充/修正 DAG。

- **D15 ③ 执行 fan-out 是落盘后的运行层**。
  - 链路:`确认后的 waves → wave[0] 多子代理并行执行 → 全部完成 → wave[1] ...`。
  - 这层不消费平铺任务清单,只消费确认后的 ExecutionPlan/waves。

- **D15 ④ UI 文案收口**。
  - 拆分运行态从"子代理对话流"改为"拆分 fan-out 运行图"。
  - 运行阶段展示:`Cluster fan-out 拆分 → Verifier 合并校验 → 交给编排层生成 DAG`。

## Decisions(D16 修订,2026-05-19 锁定 —— 编排阶段全屏承载执行确认)

> 用户修订:进入第二步"编排确认"后,左侧 PRD 框可以丝滑收起,候选任务/执行图占据全屏。既然编排阶段已经是强确认工作区,落盘执行不再需要 modal 承载。

- **D16 ① 编排确认阶段收起 PRD 面板**。
  - 用户从"候选任务复核"切到"编排确认"后,左侧 PRD 输入/锚点面板横向收起,右侧候选任务与执行图占据全宽。
  - 切回"候选任务复核"时 PRD 面板原位展开,保留编辑器状态与锚点联动。
  - 收起/展开是布局过渡,不是卸载组件。

- **D16 ② 落盘执行回到编排页主动作**。
  - "落盘执行"不再打开 modal;它在编排确认全屏状态中作为第三步主动作直接触发。
  - 编排页本身展示 wave/DAG、fan-out 派发计划与任务调整操作,承担执行前确认。

- **D16 ③ 开始执行后任务列表切换为运行队列**。
  - 执行前右侧列表 = 候选任务,可编辑、删除、确认、调整波次。
  - 点击"落盘执行"后,右侧列表 = Mission Runtime 执行队列,展示 wave、subagent、状态、依赖和操作入口。
  - 候选任务编辑不再作为主视图,只能通过"返回编排/返回编辑"显式回退。

- **D16 ④ 删除/扭转任务按状态收敛**。
  - 未开始任务:允许删除、改派、调整波次。
  - 运行中任务:不允许删除,只能查看日志、暂停后续波次或等待完成。
  - 已完成任务:不允许删除执行事实,只能查看产物、重跑、回滚或标记废弃。

- **D16 ⑤ 仓库成员区域展示 fan-out subagent 状态**。
  - 右侧"我的团队/仓库成员"应展示执行 fan-out 派发出的 subagent 实时状态。
  - 任务队列是执行图视角;仓库成员是 agent 供给/运行视角。两者展示同一批运行事实,不是两套任务。

## 修订后的核心 Loop

```
用户在左栏选 Workspace
  → Cockpit hub 默认空态(AssistantHub 卡片网格)
  → 选 builtin:prd-split 助手
  → AssistantHeader + PrdTaskSplitPanel(左 PRD / 右拆分任务)
  → 编辑 requirements / 导入历史 / 一键拆分
  → 拆分子代理(走 assistant_overrides 合并的 prompt 层)
  → 拆分结果展示(右栏任务卡片 + taskAnchors)
  → 点任务 → 左侧 PRD 段落高亮(沿用 anchorReconcile)
  → 后续:生成可执行任务 / 内容优化 / 写入 .trellis/tasks(现有路径)
```

## Notes

- 复杂任务,需要 `prd.md` + `design.md` + `implement.md`。本次先把 PRD 收敛,再写 design/implement。
- 涉及宪法层(`agent-harness-architecture.md` §2/§3),改之前需要先在该文档登记 ViewMode 与域分层的影响。
