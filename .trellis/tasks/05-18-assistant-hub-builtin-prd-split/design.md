# Design — Assistant Hub: built-in PRD-split assistant + user-created assistants

> 决策依据见 `prd.md` 的 D1-D12 + E1-E7 + **D13(2026-05-18 修订)**。本文档只展开技术设计,不重复需求陈述。
>
> ## D13 修订摘要(必读 —— 推翻此前部分设计)
>
> 用户给出截图后,**PRD-split 助手不再是对话产品,而是 PrdTaskSplitPanel 的助手层封装**。
>
> 撤回:
> - D8 LLM 多轮对话 / E1 真 tool use → 取消;LLM 仅在 splitter/verifier 子代理派发时被调用
> - D10 中央左 Chat / 右 Artifact 双栏 → 取消;改为单栏 PrdTaskSplitPanel
> - D11 / D12 大部分 → 简化为复用 anchorReconcile + 现有 "拆分"按钮
>
> 保留:
> - D1 cockpit 子态 hub/conversation
> - D2 workspaceMode 复用(已在 PrdTaskSplitPanel 内部)
> - D3 关联工作区 selector(AssistantHeader 上)
> - D4 prompt 合并链(Stage 1/2 已实现:assistant_overrides + runtime_resolver)
> - D5 四层渐进披露(L1 hub / L2 PrdTaskSplitPanel / L3 Drawer / L4 Inspector)
> - D6 skill/MCP 挂载(Stage 4)
> - D7 assistant_id 加列不回填
>
> 详见 `prd.md` D13 ① ~ ⑦。本 design.md 下面的章节按 D13 后的语义解读。

## 1. 边界与范围

**做**:
- 新增 `builtin:prd-split` 助手定义、可编辑覆盖层(prompt + skill bundle + MCP bundle + 项目级挂载)。
- **删除 `MissionControl.tsx` 全屏壳与 `MissionHeader`**(E3);保留 `MissionCanvas` 等子组件供新组件复用。
- **删除 `Author/prompts` 与 `Author/trellis-spec` 两个 Tab,删除 `PromptsPanel` 和 `ProjectTrellisCenter`**(E2/E7)。
- 在 Cockpit 内实现两态切换 `hub ↔ conversation`(`CockpitSubMode`),保持 ViewMode union 不变(D1)。
- 把 PRD-split 助手对话化:**Chat ↔ Artifact 双栏**;Mission ↔ Conversation ↔ Trellis Task 三者 1:1:1(E5)。
- **真 Anthropic tool use** 驱动 LLM 写 PRD/design/implement、触发 splitter、挂载 skill/MCP(E1)。
- 新增 `assistant_id` 列到三张审计表;`mission_runs` 增 `task_dir` 列(E5)。
- 拆分(splitter)CTA = LLM `start_splitter` 工具调用,等价 `task.py start`(D12)。
- 三个新 InspectTool:`runtime-events / workflow-graph / spec-timeline / spec-library`(E7)。
- 事件重命名 `WORKFLOW_UI_EVENT_OPEN_ASSISTANT`,无兼容 shim(E4)。

**不做**:
- 不重写 `splitterDispatch / verifierDispatch / clusterPlanner / trellisWriter` 运行时。
- 不动 mission_runs / mission_agent_assignments / trellis_agent_runs 既有写入路径与字段含义。
- 不新增 ViewMode kind;不新增侧栏顶级入口。
- 不实现助手在线市场/分发。
- 不做多对话线索(mission ↔ conversation 1:1 硬约束)。

## 2. 顶层组件树

```
ViewModeRouter
├── kind="cockpit"  ──>  CockpitSurface(新)
│     ├── AssistantHeader(新) — 始终可见
│     │     标题/描述/⚙ 设置/✨ 模型/📁 关联工作区/[Skills][MCP][Inspectors]
│     │
│     ├── cockpitSubMode={hub}      → AssistantHub(新)
│     │     • 内置 + 自建助手卡片(listAssistants)
│     │     • "最近对话"区(listMissions → 卡片含 PRD 摘要 + stage)
│     │     • 选卡片 → createAssistantConversation → cockpitSubMode={conversation}
│     │
│     ├── cockpitSubMode={conversation; missionId; assistantId}
│     │   → AssistantConversationView(新)
│     │     ├── ChatPane(复用 ClaudeMessageList + claudeStreamRuntime,sessionId 隔离)
│     │     └── ArtifactPane(新)
│     │           Tabs: PRD / Design / Implement / Tasks
│     │           • PRD/Design/Implement = read_task_artifact + diff 高亮
│     │           • Tasks = MissionCanvas(从原 MissionControl 拆出,直接复用)
│     │
│     └── AssistantSettingsDrawer(新, L3 抽屉)
│           Tabs: Prompts / Skills / MCPs / Engineering / Specs / History
│           • 作用域切换:assistant / project / repository(替代原 PromptsPanel)
│           • Specs:SpecLibraryPanel(从 ProjectTrellisCenter 拆出, E7)
│           • History:LegacyRunsModal 内容
│
└── kind="inspect"  ──>  Inspector 叠层
      ├── tool="runtime-events"  → RuntimeEventsInspector(新)
      ├── tool="workflow-graph"  → WorkflowGraphInspector(新)
      ├── tool="spec-timeline"   → SpecTimelineInspector(新)
      └── tool="spec-library"    → SpecLibraryInspector(新, E7)
```

**删除清单**:
- `src/components/MissionControl/MissionControl.tsx`
- `src/components/MissionControl/header/MissionHeader.tsx`(被 AssistantHeader 替代)
- `src/components/PromptsPanel/`(整个目录)
- `src/components/ProjectTrellisCenter.tsx` + `.test.tsx`
- `src/components/AuthorPanel/AuthorPanelTabs.tsx` 中的 `prompts / trellis-spec` 两条 Tab 项
- `src/types/viewMode.ts` `AuthorPane` union 中的 `"prompts" | "trellis-spec"`
- `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` / `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 常量及监听

## 3. 状态机:CockpitSubMode

```ts
type CockpitSubMode =
  | { kind: "hub" }
  | { kind: "conversation"; missionId: string; assistantId: string };
```

`CockpitSurface` 内部 `useState`,**不进 ViewMode union**。

挂载策略:
1. 若 ViewMode `cockpit` 携带 `missionId` → 直接 conversation;`assistantId` 由 `mission_runs.assistant_id` 决定(NULL 时默认 `builtin:prd-split`)。
2. 否则取 `useMissionLedger({ projectId: activeProjectId })` 的 `activeMission`:
   - 有 → conversation
   - 无 → hub
3. hub 内选助手卡片或最近对话 → 调 `createAssistantConversation` 拿 `missionId` → 切 conversation。
4. AssistantHeader "返回 Hub" 按钮 → 切回 hub,mission 不删。

## 4. 数据契约

### 4.1 数据库迁移

**`027_assistant_id.sql`**:
```sql
ALTER TABLE mission_runs              ADD COLUMN assistant_id TEXT;
ALTER TABLE mission_runs              ADD COLUMN task_dir TEXT;
ALTER TABLE mission_agent_assignments ADD COLUMN assistant_id TEXT;
ALTER TABLE trellis_agent_runs        ADD COLUMN assistant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_mission_runs_assistant
  ON mission_runs(assistant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_runs_task_dir
  ON mission_runs(task_dir);
```

存量行 `assistant_id IS NULL` = 前助手时代;`task_dir IS NULL` = 旧 mission 没绑定 task 目录(UI 中标"早期版本")。

**`028_assistant_overrides.sql`**:
```sql
CREATE TABLE IF NOT EXISTS assistant_overrides (
  assistant_id        TEXT NOT NULL,         -- builtin:prd-split / custom:<id>
  scope               TEXT NOT NULL,         -- "assistant" | "project:<id>" | "repository:<id>"
  prompt_layers_json  TEXT NOT NULL DEFAULT '{}',
  skill_bundle_json   TEXT NOT NULL DEFAULT '{}', -- { disabled: string[], custom: SkillRef[] }
  mcp_bundle_json     TEXT NOT NULL DEFAULT '{}',
  engineering_json    TEXT NOT NULL DEFAULT '{}',
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (assistant_id, scope)
);
```

`scope` 取代旧 `Author/prompts` 中的 project/repository 层独立存储——**统一表**容纳助手层、项目层、仓库层覆盖。删除 `app_settings.split_prompt_layers:platform_default` 这条种子的"用户可改"路径(平台默认改为纯硬编码,不可改);如需改默认,发版升级。

迁移期处理:旧 `app_settings.split_prompt_layers` / 项目/仓库层旧存储,通过一次性脚本搬到 `assistant_overrides`(scope=`project:<id>` / `repository:<id>`,assistant_id=`builtin:prd-split`)。

### 4.2 助手内置 bundle

`src-tauri/src/assistants/builtins/prd_split.rs`:
```rust
pub struct BuiltinAssistantBundle {
    pub assistant_id: &'static str,
    pub default_workflows: &'static [BuiltinWorkflowRef], // Wise 内置 Trellis 编排,不是 Claude skill 注入
    pub default_skills: &'static [BuiltinSkillRef],       // PRD split 主能力不走这里
    pub default_mcps:   &'static [BuiltinMcpRef],
    pub default_prompt_layers: BuiltinPromptLayers, // prdTaskSplit / phase1 / phase2
    pub system_prompt: &'static str,                // include_str! 自 .trellis/spec/guides/trellis-brainstorm.md
    pub tools: &'static [&'static str],             // ["update_prd","update_design",...]
}
```

### 4.3 IPC 增量

| 命令 | 用途 |
|------|------|
| `assistants_get_overrides({ assistantId, scope })` | 读单条 overrides |
| `assistants_save_overrides({ assistantId, scope, patch })` | 局部更新 |
| `assistants_reset_overrides({ assistantId, scope, sections })` | sections ∈ `prompts/skills/mcp/engineering/all` |
| `assistants_resolve_runtime({ assistantId, projectId? })` | 返回 merge 完成的 `{ promptLayers, skills, mcps, engineering }`,供运行时与 UI 用 |
| `mission_create_with_task({ assistantId, projectId, slug?, title? })` | **原子**创建 task 目录 + mission_runs 行(E5) |
| `mission_record_chat_event({ missionId, role, parts, claudeSessionId })` | 落 `mission_events.chat_message` |
| `mission_list_recent({ projectId?, limit })` | hub "最近对话"区数据源 |
| `read_task_artifact({ taskDir, kind })` | kind ∈ `prd / design / implement` |
| `write_task_artifact({ taskDir, kind, markdown })` | LLM tool `update_*` 走这里 |
| `assistant_tool_dispatch({ missionId, toolUseId, toolName, input })` | 真 tool use 路由(见 §5.3) |

权限:`write_task_artifact` 与 `assistant_tool_dispatch` 路径校验必须落在 `.trellis/tasks/` 子树内。

### 4.4 prompt 合并链

```
平台硬编码默认
  → assistants_resolve_runtime 取 builtin bundle default(若是 builtin 助手)
  → assistant_overrides[scope="assistant"]
  → assistant_overrides[scope="project:<id>"]
  → assistant_overrides[scope="repository:<id>"]
```

`composeSplitterPrompt / composeVerifierPrompt` 调用前注入 `assistantId + projectId + repositoryId`,通过 `assistants_resolve_runtime` 一次性拿到合并结果。原 `splitPromptBundle.ts` 的字段非空覆盖语义保留。

## 5. 对话产品(D8-D11 + E1)

### 5.1 ChatPane

复用 `claudeStreamRuntime` 的 stream 处理,但 sessionId 隔离(不进 ClaudeSessions tab 列表)。

`useAssistantConversation` hook:
```ts
function useAssistantConversation(opts: { missionId; assistantId; projectId }) {
  // - 拉 mission_events.chat_message 重建 ClaudeSession.messages
  // - 通过 assistants_resolve_runtime 拿 system prompt + tools 列表
  // - 流式新消息:tool_use block → assistant_tool_dispatch 路由 → tool_result 注回
  // - 用户消息 / 助手消息 都落 mission_record_chat_event
}
```

### 5.2 ArtifactPane

- Tabs:`PRD`(始终)/ `Design`(写过即出现)/ `Implement`(同)/ `Tasks`(splitter 跑过即出现)。
- PRD/Design/Implement:`read_task_artifact` 拉 markdown,Milkdown 渲染;LLM 写入触发段落 hash diff 高亮。
- Tasks:直接挂 `<MissionCanvas>`(原 MissionControl 内核拆出),props 等价透传;它原本依赖的 `MissionHeader` 渲染由 AssistantHeader 接管。

### 5.3 LLM 真 tool use(E1)

`claudeStreamRuntime` 加 tool dispatcher:
```ts
// src/services/assistantToolDispatcher.ts
export async function dispatchToolUse(args: {
  missionId: string; toolUseId: string; toolName: string; input: unknown;
}): Promise<{ result: unknown; isError: boolean }> {
  // 高危工具:首次/破坏性调用 → 弹 confirm modal
  // 路由到对应 IPC,失败包成 { isError: true, content: errorString }
  // 把 tool_result 注回 Claude stream(claudeStream API)
}
```

工具表(初版):

| Tool | 入参 | 行为 |
|------|------|------|
| `update_prd` | `{ markdown }` | `write_task_artifact(prd)` |
| `update_design` | `{ markdown }` | `write_task_artifact(design)` |
| `update_implement` | `{ markdown }` | `write_task_artifact(implement)` |
| `read_artifact` | `{ kind }` | `read_task_artifact` |
| `start_splitter` | `{ note? }` | `task.py start` + 启动 `splitterDispatch`;**首次需 confirm** |
| `open_inspector` | `{ tool: "runtime-events" \| "workflow-graph" \| "spec-timeline" \| "spec-library" }` | dispatch ViewMode `inspect` |
| `list_mcps` | `{}` | 同上 |
| `mount_mcp` | `{ mcpId, action }` | 同上;**confirm** |

system prompt 由 `assistants_resolve_runtime` 返回。需求拆分主能力由 Wise 内置 Trellis workflow 编排,不通过 `CLAUDE.md` 或 `.claude/skills` 注入。

## 6. Task ↔ Requirement 追溯(D11)

复用既有 `sourceRequirementIds`。UI 增量:
- ArtifactPane PRD Tab:每个 requirement 段落挂 `data-requirement-id` + 派生任务 chip 列表;点 chip 切到 Tasks Tab + setSelection。
- ArtifactPane Tasks Tab(MissionCanvas):任务卡 select → emit setSelection → PRD Tab `scrollIntoView` + 高亮。
- design.md / implement.md 段落 anchor 用 `anchorReconcile.ts` 的 hash 派生算法,LLM 重写后引用稳定。

## 7. ViewMode / Inspector 增量(L4 + E7)

`InspectTool` union 扩展:
```ts
export type InspectTool =
  | InspectCodeGraph
  | InspectWorkflowStudio
  | { kind: "runtime-events"; rootPath: string; projectId: string | null }
  | { kind: "workflow-graph"; rootPath: string; projectId: string | null }
  | { kind: "spec-timeline";  rootPath: string }
  | { kind: "spec-library";   rootPath: string };
```

`ViewModeRouter` 增加 4 个 case;`AssistantHeader` 提供 4 个入口按钮。

`ProjectTrellisCenter` 整体删除;其内部组件按用途拆出:
- `OnboardingChecklist / AgentOwnershipGraph / RuntimeEventFeed` → `RuntimeEventsInspector`。
- `SpecRevisionTimeline / WorkspaceSnapshotViewer` → `SpecTimelineInspector`。
- `WorkflowGraphPanel` → `WorkflowGraphInspector`。
- `SpecLibraryPanel` → `SpecLibraryInspector`(只读) + `AssistantSettingsDrawer/Specs Tab`(可写)。

## 8. 入口收口(E4)

- 新事件:`WORKFLOW_UI_EVENT_OPEN_ASSISTANT { assistantId?, projectId?, repositoryId? }`。
- 删除:`WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD`、`WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 及全部 listener。
- 调用方一次性迁移:LeftSidebar / RepositoryAssociateModal / 项目 FAB / cc-workflow-studio 等。

## 9. 风险与回退

| 风险 | 对策 |
|------|------|
| 真 tool use 在某些模型上行为差异 | tool 列表通过 `assistants_resolve_runtime` 动态可控;首版只接 Claude;未来扩展引擎单独适配。 |
| 删除 PromptsPanel / ProjectTrellisCenter 让现有用户的 project/repository 层覆盖丢失 | 一次性 migration 把旧存储搬到 `assistant_overrides`(scope=`project:<id>`/`repository:<id>`,assistant_id=`builtin:prd-split`)。 |
| `mission_create_with_task` 调 `task.py` 是 Python,Tauri 进程依赖 Python | 阶段 1 提供 Rust 等价实现(只做 mkdir + 写 task.json + 写 prd.md skeleton),不依赖 Python;后续若需要 `task.py` 高级行为再走子进程。 |
| 旧 mission 无 task_dir,UI 处理 | UI 兜底显示"早期版本",不可继续编辑 PRD,但可继续看任务泳道(只读)。 |
| Cockpit 启动时无 active project | hub 渲染并提示"先在左栏选 Workspace 或注册仓库";助手卡片仍可点击,选完后再 enforced 选项目。 |
| `assistant_tool_dispatch` 滥用写文件 | 路径校验:输入路径必须落在 `.trellis/tasks/<dir>/{prd,design,implement}.md`;其它一律拒绝。 |

## 10. 验收要点

- [ ] AssistantHub 默认主屏渲染;有 active mission 自动恢复对话。
- [ ] AssistantHeader 切换关联工作区;Standalone Repo 提示升格。
- [ ] L3 Drawer 在三种 scope(assistant / project / repository)间编辑 prompt/skill/mcp,保存生效;reset 删除该 scope 行。
- [ ] LLM 通过真 tool use 写入 PRD,ArtifactPane PRD Tab 实时刷新且高亮 diff。
- [ ] `start_splitter` 首次调用弹 confirm,通过后任务出现在 Tasks Tab;`mission_agent_assignments.assistant_id = "builtin:prd-split"`。
- [ ] InspectTool runtime-events / workflow-graph / spec-timeline / spec-library 四个叠层从 AssistantHeader 打开。
- [ ] 旧 mission `assistant_id IS NULL` + `task_dir IS NULL`,UI 显示"早期版本"且可继续操作(只读)。
- [ ] `Author/prompts / Author/trellis-spec` Tab 已删除;旧 PromptsPanel/ProjectTrellisCenter 文件不再存在。
- [ ] `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD / OPEN_MISSION_CONTROL` 全仓搜索为零。
- [ ] `MissionControl.tsx / MissionHeader.tsx / PromptsPanel/* / ProjectTrellisCenter.tsx` 全部删除。
