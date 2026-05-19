# Implement — Assistant Hub: built-in PRD-split assistant + user-created assistants

> 决策依据:`prd.md` D1-D12 + E1-E7 + **D13(2026-05-18 修订,见 prd.md)**;技术细节见 `design.md`。
>
> ## D13 后的实施状态(2026-05-18 锁定)
>
> 已完成(保留):
> - Stage 0 宪法登记 + migration 027/028/029
> - Stage 1 后端 builtins / overrides / runtime_resolver / task_artifact / mission_create_with_task / 各 IPC 命令
> - Stage 2 `assistantPromptLayers.ts` + `resolveSplitPromptLayers.ts` 接入 assistant_overrides
> - Stage 3 Wave A:CockpitSurface / AssistantHub / AssistantHeader 壳层(全部保留)
>
> 需回退(D13 撤销):
> - Wave B #1 ArtifactPane 4 Tab(`src/components/CockpitSurface/ArtifactPane.tsx`)→ 删除
> - Wave B #2 ChatPane / useAssistantConversation / missionEventChat → 删除
> - 相关 css 段落 → 删除
> - `AssistantConversationView` 改为薄封装,直接渲染 `<MissionControl>`(沿用现状,等 Stage 5 决定是否换 PrdTaskSplitPanel 直挂)
>
> 后续阶段调整:
> - Stage 3 大阶段范围缩小:只完成"hub → conversation 切换 + AssistantHeader",**不再**做 ChatPane / 真 tool use
> - Stage 4 不变(L3 Drawer)
> - Stage 5 不变(L4 Inspector + 删 ProjectTrellisCenter)
> - 入口收口(MissionControl.tsx / 旧事件常量删除)放在 Stage 5 或独立小阶段

## 阶段 0:宪法登记 + 旧覆盖层迁移脚本(动代码前)

- [ ] 改 `.trellis/spec/guides/agent-harness-architecture.md`:
  - §3 状态机:登记 `cockpit` 内部 `cockpitSubMode = "hub" | "conversation"`(不挂 ViewMode union)。
  - §4 Cockpit 三栏:左栏 Workspace 树不变;主区由 `CockpitSurface` 渲染;右栏 Inspector 透镜按 ViewMode `inspect` 叠层。
  - §7 P3 修订:删除 Author 域 `Prompts / Trellis Spec` 两个 Tab(`Trellis 规范`Tab 不再存在,Spec 库迁出 Author)。
  - §8 决策记录追加 D1-D12 + E1-E7。
- [ ] 草拟 migration 脚本顺序:
  - `027_assistant_id.sql`:`mission_runs / mission_agent_assignments / trellis_agent_runs` 加 `assistant_id`;`mission_runs` 加 `task_dir`;两个索引。
  - `028_assistant_overrides.sql`:`assistant_overrides(assistant_id, scope, prompt_layers_json, skill_bundle_json, mcp_bundle_json, engineering_json, updated_at, PRIMARY KEY(assistant_id, scope))`。
  - `029_migrate_prompt_layers_into_assistant_overrides.sql`:把旧的 `app_settings.split_prompt_layers:project:<id>` / `:repository:<id>` 行搬到 `assistant_overrides`(assistant_id=`builtin:prd-split`,scope=`project:<id>`/`repository:<id>`),搬完后从 `app_settings` 删除。

**回滚锚点 0**:本节产出独立 commit;若回滚,所有后续改动失去依据。

## 阶段 1:数据库 + assistants/builtins + IPC 命令(纯后端)

- [ ] 落 027 / 028 / 029 三条 migration,加入 `wise_db.rs` include list。
- [ ] 新增 `src-tauri/src/assistants/builtins/{mod.rs, prd_split.rs, default_claude.rs}`:
  - `BuiltinAssistantBundle` 结构(见 design §4.2)。
  - `prd_split.rs::system_prompt = include_str!("../../../../.trellis/spec/guides/trellis-brainstorm.md")`(注:include_str! 路径相对编译位置,实际可能需要 build.rs 复制或调整 include 路径)。
  - `default_workflows / default_mcps / default_prompt_layers / tools` 字面量；PRD split 主能力不写入 `default_skills`。
- [ ] 改 `src-tauri/src/assistants/commands.rs`:
  - `assistants_list` 改为遍历 builtin 注册表(包含 `default-claude` + `prd-split`)+ custom + extension。
  - 删除 `BUILTIN_DEFAULT_SYSTEM_PROMPT` 常量;`assistants_get_system_prompt` 走 builtin 注册表。
  - 新增:`assistants_get_overrides / save_overrides / reset_overrides / resolve_runtime`。
- [ ] 新增 `src-tauri/src/assistants/overrides.rs`(`assistant_overrides` 表 CRUD)与 `src-tauri/src/assistants/runtime_resolver.rs`(merge 链实现:platform default → builtin → assistant scope → project scope → repository scope)。
- [ ] 改 `src-tauri/src/mission_control.rs`:
  - 新命令 `mission_create_with_task`:原子完成 (a) Rust 等价的 task 目录创建(`mkdir -p .trellis/tasks/<MM-DD-slug>` + 写 `task.json` + 写默认 `prd.md`,完全 Rust 实现,不依赖 `task.py`);(b) 写 `mission_runs` 行(含 `task_dir / assistant_id`)。
  - 新命令 `mission_record_chat_event`:`mission_events` 增 `chat_message` 类型。
  - 新命令 `mission_list_recent({ projectId?, limit })`。
  - 既有 `mission_create / mission_agent_assignments / trellis_agent_runs` 写入处全部接受并写 `assistant_id`(必填,默认 `builtin:prd-split`)。
- [ ] 新增 `src-tauri/src/task_artifact.rs`:`read_task_artifact / write_task_artifact` 命令;路径校验落在 `.trellis/tasks/<dir>/{prd,design,implement}.md`,任何逃逸返回 Err。
- [ ] 新增 `src-tauri/src/assistant_tool_dispatch.rs`:统一 tool 路由命令(可由前端直接调,也可由 `claudeStreamRuntime` 在收到 tool_use 后调)。
- [ ] `src-tauri/src/lib.rs` 注册全部新命令;`capabilities/default.json` 加 allowlist。
- 验证:`cd src-tauri && cargo check && cargo test`;手测启动后看 SQLite 表结构 + 运行 029 后老覆盖层数据已搬家。

**回滚锚点 1**:三条 migration 提供 down 脚本(SQLite 限制下用"复制 → drop → 重建无新列表"的步骤注释)。出问题回滚到锚点 0。

## 阶段 2:Prompt 合并链 + Splitter/Verifier 接入

- [ ] 新增 `src/services/assistantPromptLayers.ts`:封装 `assistants_resolve_runtime` IPC,返回 merge 完成的 `{ promptLayers, skills, mcps, engineering, systemPrompt, tools }`。
- [ ] 改 `src/services/prdSplit/splitterDispatch.ts` `composeSplitterPrompt`:接受 `assistantId / projectId / repositoryId`(默认 `builtin:prd-split`),调用 `assistantPromptLayers`。
- [ ] 同改 `verifierDispatch.ts`。
- [ ] 单测:
  - `assistantPromptLayers.test.ts`:platform → builtin → assistant → project → repository 五段 merge,字段非空覆盖语义一致。
  - 已有 `splitterDispatch.test.ts / verifierDispatch.test.ts` 补一组"assistantId=builtin:prd-split 时 prompt 含助手默认 systemBody"。
- 验证:`bun test src/services/prdSplit src/services/assistantPromptLayers`。

**回滚锚点 2**:独立 commit。回滚后 splitter/verifier 仍可调,但不再注入助手层(行为退化为 028 之前)。

## 阶段 3:CockpitSurface + AssistantHub + AssistantConversationView + 双栏 + ToolDispatcher(E6 合并大阶段)

> E6 锁定:本阶段一次性把 Cockpit 新主屏完整上线,不允许 stub fallback。

### 3.1 骨架与状态

- [ ] 新增 `src/components/CockpitSurface/index.tsx`:管理 `cockpitSubMode`,render `AssistantHub | AssistantConversationView`,挂 `AssistantHeader` 与 `AssistantSettingsDrawer`。
- [ ] 新增 `src/components/CockpitSurface/AssistantHeader.tsx`:标题/描述/⚙ 按钮/✨ 模型/📁 关联工作区 selector(默认值 = activeProjectId,Standalone Repo 提示)/Skills 入口/MCP 入口/Inspectors 入口(下拉:runtime-events / workflow-graph / spec-timeline / spec-library)/返回 Hub 按钮。
- [ ] 新增 `src/components/CockpitSurface/AssistantHub/index.tsx`:
  - "助手"区:`listAssistants` → 卡片网格(HubCard / HubItem)。
  - "最近对话"区:`mission_list_recent({ projectId: activeProjectId })` → 卡片(显示 PRD 摘要 + stage + assistant 名 + 时间)。
  - 顶部欢迎屏 + AionUI 风格输入条(贴 PRD / 选文件 / 提交 = 调 `mission_create_with_task` + 切 conversation)。
- [ ] 新增 `useCockpitSubMode` hook:封装挂载策略(见 design §3)。

### 3.2 对话双栏

- [ ] 新增 `src/components/CockpitSurface/AssistantConversationView/index.tsx`:左 ChatPane / 右 ArtifactPane,可拖拽分隔。
- [ ] 新增 `src/hooks/useAssistantConversation.ts`(见 design §5.1):
  - 拉 `mission_events.chat_message` 重建 `ClaudeSession.messages`。
  - 接 `claudeStreamRuntime`(隔离 sessionId)。
  - system prompt + tools 从 `assistants_resolve_runtime` 取。
  - 流式新消息 push + emit `mission_record_chat_event`。
- [ ] 新增 `src/components/CockpitSurface/AssistantConversationView/ChatPane.tsx`:复用 `ClaudeMessageList` 等渲染组件。
- [ ] 新增 `.../ArtifactPane.tsx`:Tabs(`PRD / Design / Implement / Tasks`),Tab 出现条件:写过 / splitter 跑过(由 `mission_runs` 字段或 task 目录文件存在性判定)。
- [ ] PRD/Design/Implement Tab:`read_task_artifact` 读 → Milkdown 渲染;LLM 写入触发段落 hash diff 高亮(沿用 `anchorReconcile.ts` 的 hash 算法)。
- [ ] Tasks Tab:`<MissionCanvas>` 直接挂(从原 MissionControl 拆出);props 透传。

### 3.3 真 tool use 路由(E1)

- [ ] 改 `src/services/claudeStreamRuntime.ts`:在解析 stream 时识别 `tool_use` block;对于本助手注册的工具,调 `dispatchToolUse` 而非透传。
- [ ] 新增 `src/services/assistantToolDispatcher.ts`:工具表实现(见 design §5.3),含 confirm 网关(高危工具首次调用弹 Antd Modal)。
- [ ] tool_result 通过 `claudeStream` 写回(可能需要后端支持 inject tool_result 的命令;若不支持,走"前端构造 user 消息 with tool_result block"的兼容路径)。

### 3.4 PRD ↔ Tasks 追溯

- [ ] PRD Tab:requirementsIndex 渲染加 `data-requirement-id`,挂派生任务 chip。
- [ ] Tasks Tab(MissionCanvas):setSelection 回调通知 ArtifactPane 切 PRD Tab + scrollIntoView。
- [ ] design.md / implement.md 段落 anchor:Markdown 渲染时按段落 hash 生成 anchor id,LLM 重写后保留稳定引用。

### 3.5 入口替换 + 老组件删除(E3/E4)

- [ ] 新事件常量 `WORKFLOW_UI_EVENT_OPEN_ASSISTANT`(替换两个旧常量)。
- [ ] AppImpl / AppWorkspaceLayout / LeftSidebar / RepositoryAssociateModal / cc-workflow-studio 全部一次性切到新事件。
- [ ] 删除文件(同 commit):
  - `src/components/MissionControl/MissionControl.tsx`
  - `src/components/MissionControl/header/MissionHeader.tsx`
  - `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` / `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 常量及 listener。

### 3.6 验证

- [ ] `bun test`(`CockpitSurface / AssistantHub / AssistantConversationView / useAssistantConversation / assistantToolDispatcher` 等覆盖)。
- [ ] `cd src-tauri && cargo check && cargo test`。
- [ ] 手测端到端:左栏点 Workspace → 进 hub → 选 PRD 拆分助手 → AionUI 入口页 → 粘 PRD → LLM 通过 tool 写 prd.md → 双栏右栏出现 → 触发 start_splitter → confirm → 任务进 Tasks Tab → mission_agent_assignments.assistant_id 写入正确。

**回滚锚点 3**:本阶段是单一大 commit(可分 3.1-3.5 五个子 commit 但同一 PR)。回滚意味着主屏完全回到旧状态——尽量避免,出错优先就地修。

## 阶段 4:AssistantSettingsDrawer(L3 + E2/E7)

- [ ] 新增 `src/components/CockpitSurface/AssistantSettingsDrawer/index.tsx`,Tabs:
  - `Prompts`:三 slot(prdTaskSplit / phase1 / phase2)× 三 body(systemBody / repoStrategyBody / userBody) × 三 scope(assistant / project / repository) 编辑器,带"重置"。
  - `Skills`:内置 bundle(可启停)+ 项目挂载(从全局 skills 库选,可增删)。
  - `MCPs`:同 Skills。
  - `Engineering`:`reuseExistingParents / dispatchOnlyDirty` 等开关。
  - `Specs`:`SpecLibraryPanel`(从 ProjectTrellisCenter 拆出)的可写视图(per-assistant × per-workspace)。
  - `History`:`mission_list_recent` 完整列表 + LegacyRunsModal 内容。
- [ ] 新增 `src/services/assistantOverrides.ts`:封装 `get / save / reset` IPC,debounce 写。
- [ ] 删除文件(同 commit):
  - `src/components/PromptsPanel/`(整个目录)
  - `src/components/AuthorPanel/AuthorPanelTabs.tsx` 中 `prompts / trellis-spec` 两条 Tab 项
  - `src/types/viewMode.ts` `AuthorPane` union 中的 `"prompts" | "trellis-spec"`
  - `WORKSPACE_SCOPED_AUTHOR_PANES` 中 `"prompts" | "trellis-spec"`
- [ ] AppImpl / AppWorkspaceLayout 中相关分支删除。
- 验证:`bun test`;手测 Drawer 编辑各 scope 后 splitter 行为对应(scope 优先级正确)。

**回滚锚点 4**:Drawer 是新组件;若回滚,数据库 `assistant_overrides` 表保留,下次启用即可读出。删除的 PromptsPanel 不再需要恢复。

## 阶段 5:Inspector 透镜拆出(L4 + E7)

- [ ] `src/types/viewMode.ts` 扩展 `InspectTool` union(4 个新 kind)。
- [ ] 新增:
  - `src/components/Inspectors/RuntimeEventsInspector.tsx`:OnboardingChecklist + AgentOwnershipGraph + RuntimeEventFeed。
  - `src/components/Inspectors/SpecTimelineInspector.tsx`:SpecRevisionTimeline + WorkspaceSnapshotViewer。
  - `src/components/Inspectors/WorkflowGraphInspector.tsx`:WorkflowGraphPanel。
  - `src/components/Inspectors/SpecLibraryInspector.tsx`:SpecLibraryPanel(只读)。
- [ ] AppWorkspaceLayout 的 `inspect` 分支按新 kind 路由。
- [ ] AssistantHeader Inspectors 下拉触发 ViewMode dispatch。
- [ ] 删除文件(同 commit):`src/components/ProjectTrellisCenter.tsx` + `.test.tsx` + `.css`(若有)。
- 验证:四个透镜从 AssistantHeader 唤起;关闭后回到 cockpit/hub 或 cockpit/conversation。

**回滚锚点 5**:Inspector 拆解独立 commit;回滚需要恢复 ProjectTrellisCenter 与对应入口。

## 阶段 6:验收 + 文档

- [ ] 全量回归:`bun test`、`cd src-tauri && cargo test`、`bun run build`(终验)。
- [ ] 验收 prd.md acceptance 与 design §10 全部勾上。
- [ ] 全仓 grep 确认零残留:
  - `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD`
  - `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`
  - `MissionControl.tsx` / `MissionHeader.tsx` / `PromptsPanel` / `ProjectTrellisCenter`
  - `BUILTIN_DEFAULT_SYSTEM_PROMPT`(已删除常量)
- [ ] 更新 `CLAUDE.md`:Architecture / Frontend 段落登记 `CockpitSurface` 为新主屏;移除 `MissionControl.tsx` / `PromptsPanel` / `ProjectTrellisCenter` 引用。
- [ ] 更新 `.trellis/spec/frontend/index.md` 与 `.trellis/spec/tauri/index.md`(IPC 增量、组件目录新归属)。
- [ ] 新写 `.trellis/spec/guides/assistant-prd-split.md`:助手 tool use 协议、prompt 合并链顺序、scope 切换语义。

## 顺序约束(强制)

```
0(spec + migration 草图)
  → 1(后端 db + IPC + builtins)
  → 2(prompt 合并链)
  → 3(主屏大阶段:CockpitSurface + Hub + Conversation + 双栏 + ToolDispatcher + 老入口删除 + MissionControl 删除)
  → 4(SettingsDrawer + Author 两 Tab 删除 + PromptsPanel 删除)
  → 5(Inspector 拆出 + ProjectTrellisCenter 删除)
  → 6(验收 + 文档)
```

阶段 3 是最大单元;允许在内部再拆 5 个子 commit 但同 PR 合入。阶段 4/5 与阶段 3 弱独立但顺序后置以减少回归面。

## 验证命令

```bash
bun test                              # 每阶段必跑
cd src-tauri && cargo check && cd ..   # 阶段 1-6 必跑
cd src-tauri && cargo test && cd ..    # 阶段 1/3/6 必跑
bun run build                         # 阶段 6 终验
```

> 项目规则:任务执行期间不开 dev/serve 命令;UI 变更靠手测在用户授权下进行。

## 不允许的捷径

- 不允许 stub fallback(E6):任何阶段 PR 进 main 时,新主屏路径必须可用;禁止"暂时还能切回老 MissionControl"。
- 不允许保留兼容事件(E4):旧事件常量与 listener 在阶段 3 同 commit 删除。
- 不允许保留 PromptsPanel / ProjectTrellisCenter / MissionControl.tsx 任一文件(E2/E3/E7):阶段 3-5 完成时全部删除。
- 不允许在 cockpit 之外再加新 ViewMode kind(D1):cockpitSubMode 留在组件内部 useState。
