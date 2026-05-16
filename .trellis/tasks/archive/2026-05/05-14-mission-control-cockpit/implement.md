# Mission Control 实施计划

## 总体节奏

按"骨架先行 → 主画布 → 抽屉 → 切换主入口 → 测试与清理"五步推进。每步完成后跑 `bun test` + `tsc --noEmit`（或 `bun run build` 的 type-check 部分）作为门禁。

⚠️ 项目规则：**严禁** AI 自行启动 `bun run tauri:dev` / `bun run dev`。可视化效果交由用户验收。

---

## Step 1 · 目录骨架与 Presenter 数据层

**目标**：先把可测的纯函数与类型骨架立起来，UI 还没接入。

- [ ] 创建 `src/components/MissionControl/` 目录与子目录（见 design §2）。
- [ ] 写 `presenter/types.ts`：`MissionPhase / TaskUserStatus / MissionViewModel / RequirementCardVM / ParallelLayerVM / TaskCardVM / TaskEvidenceVM / MissionSelection / EngineeringDetailsVM`。
- [ ] 写 `presenter/statusModel.ts`：`toUserStatus(clusterRun, writeResult?, validationIssues?)` 与 `STATUS_COPY` 表；用户面 5 态映射。
- [ ] 写 `presenter/statusModel.test.ts`：覆盖 idle/creating-parent/dispatching/succeeded/failed/skipped-clean/有 validation 7 个分支。
- [ ] 写 `presenter/projectMission.ts`：纯函数 `projectMission(state: WizardState, selection: MissionSelection, repositories: Repository[]): MissionViewModel`。
- [ ] 写 `presenter/projectMission.test.ts`：6 个 fixture（空 / drafting+md / planning / 部分 dispatch / 全 dispatch / 写入完成）。
- [ ] 写 `copy.ts`：词汇表（PHASE_LABEL / USER_STATUS_LABEL / ROLE_LABEL / COPY）。
- [ ] 写 `useMissionPresenter.ts`：`{ state, viewModel, selection, setSelection, actions: { ... } }`。actions 是对 `useSplitWizardState` api 的薄包装。
- [ ] 写 `useMissionPresenter.test.ts`：模拟若干 reducer 操作，断言 viewModel 阶段过渡。

**验证**：

```bash
bun test src/components/MissionControl/presenter
```

**回退点**：本步骤所有产出在 `MissionControl/**` 内；删除目录可完全回滚。

---

## Step 2 · 主画布三列与 Header 组件

**目标**：组件树搭出来，能消费 ViewModel，但还未挂载到 App。

- [ ] `canvas/MissionCanvas.tsx`：三列 grid（22/56/22）；接收 viewModel + dispatch。
- [ ] `canvas/RequirementsColumn.tsx` + `RequirementCard.tsx`：左列卡片，click 派发 `setSelection({ requirementId })`。
- [ ] `canvas/TaskGraphColumn.tsx` + `ParallelLayerBlock.tsx` + `TaskCard.tsx`：中列并行层堆叠；可并行层用粗虚线；瓶颈层 warning 描边；任务卡片显示选中态/高亮/dimmed。
- [ ] `canvas/DependencyConnector.tsx`：层间 SVG 连线（基础版本：从上层底部到下层顶部居中竖线 + 箭头）。
- [ ] `details/EvidencePane.tsx`：右列证据面板；空态/选中态切换；嵌入 `AnchorSection`、`TaskEditorInline`、`EngineeringFoldout`。
- [ ] `details/AnchorSection.tsx`：PRD 锚点（preview + "在 PRD 中查看"按钮触发 `AnchorViewerModal`）、代码锚点列表（点击 dispatch `WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE`）。
- [ ] `details/TaskEditorInline.tsx`：标题/角色/子项/DoD 编辑器；调用 `actions.patchTaskEdit`。子项与 DoD 沿用 `ReviewStage` 中的 `ListEditor`：把 `ListEditor` **移动**到 `MissionControl/legacy/ListEditor.tsx` 并修正引用。
- [ ] `details/EngineeringFoldout.tsx`：选中任务的工程细节折叠区。
- [ ] `header/MissionHeader.tsx` + `MissionPhaseStrip.tsx` + `MissionRiskBadge.tsx`：使命标题 / 4 阶段进度 chips / 风险计数 / 主 CTA。
- [ ] `MissionControl.tsx` 顶层组件：`useSplitWizardState() → useMissionPresenter() → <MissionHeader/><MissionCanvas/>`；管理 selection state；把 props 传入。
- [ ] 把 `ReviewStage` 内的 `AnchorViewerModal` 抽到 `MissionControl/legacy/AnchorViewerModal.tsx`。

**验证**：

```bash
bun test
bunx tsc --noEmit -p tsconfig.json
```

**回退点**：MissionControl 还未挂载到 App，删除目录即回滚。

---

## Step 3 · Setup 抽屉与工程细节抽屉

- [ ] `setup/MissionSetupDrawer.tsx`：右侧抽屉，宽 ~560；包含目标项目/仓库切换（沿用 `targetModel.ts` 与 `projectToPrdSplitTarget/repositoryToPrdSplitTarget`）、参与仓位 Checkbox、PRD TextArea、从历史 PRD 导入入口（沿用 `legacyRunsImport.ts`）。提交 → `actions.reset` → `actions.setPrdMarkdown` → `actions.parseAndPlan`。
- [ ] `setup/MissionTargetPicker.tsx`：精简版 TargetPicker。文案使用 copy 表。
- [ ] 在 `MissionHeader` 提供 "重新粘贴 PRD" 入口（带 `Modal.confirm`），调用 `actions.backToInput()` 后打开 Setup。
- [ ] `engineering/EngineeringDrawer.tsx`：右侧抽屉，宽 ~720；分两个 Tab：「任务分组」「工作流图」。
  - 任务分组 Tab：`ClusterDetailsCard` 列表（cluster id、内部 status、diff badge、validation 列表、parentTaskName、reassign/rename 入口、verifier 重跑按钮、跳过未变化开关）。
  - 工作流图 Tab：展示 `workflowGraphResult`（nodeCount/edgeCount/workflowId/status）+ "打开执行编排" 按钮。
- [ ] `engineering/ClusterDetailsCard.tsx`：直接复用 `ReviewStage` 中的 `RequirementTag` 与 `DiffBadge`（移动到 `legacy/`）。
- [ ] `engineering/ValidationIssueList.tsx`。
- [ ] Header 右上角 "高级 · 工程细节" 按钮 → 开关 EngineeringDrawer。

**验证**：

```bash
bun test
bunx tsc --noEmit
```

**回退点**：抽屉是叶子组件，互相独立可删。

---

## Step 4 · 接入 AppImpl + 切换主入口

**目标**：让 MissionControl 真正成为新主入口，旧 modal 不再启动。

- [ ] `src/constants/workflowUiEvents.ts`：新增 `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL = "wise:open-mission-control"` 与 `OpenMissionControlDetail`。
- [ ] `src/AppImpl.tsx`：
  - 新增 `missionControlMode` state；在 `setMcpHubMode/setSkillsHubMode/...` 同级互斥。
  - 新增 `missionControlInitialTarget` state（`{ projectId?, repositoryId? }`），在打开时设置。
  - 改 `openPrdSplitWizard` → 改名为 `openMissionControl`：设置 mode + initial target。保留原函数名作 alias 以兼容其它调用方。
  - 把对 `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` 的监听改为路由到 `openMissionControl`。
  - 同时监听新事件 `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`。
  - 把 `missionControlProps = { projects, repositories, initialTarget, onClose: () => setMissionControlMode(false) }` 一并传给 `AppWorkspaceLayout`。
- [ ] `src/components/AppWorkspaceLayout.tsx`：增加 `missionControlMode` 分支，使用 `.app-full-width-main` 容器懒加载 `<MissionControl />`。隐藏左 resize handle 与 promptsMode 同条件。
- [ ] `src/components/PrdSplitWizard/Host.tsx`：
  - FAB tooltip 改为「使命控制台 · Mission Control」。
  - FAB 点击 dispatch `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`（同时保留旧事件 dispatch 以兼容）。
  - 移除 `<PrdSplitWizardModal ...>` 的 mount；保留 Host 组件本身做 FAB 提供者。
- [ ] `src/components/PrdSplitWizard/index.ts`：
  - 保留 `PrdSplitWizardModal` 文件不删；从 barrel 中移除导出（或加 `@deprecated`），确保新代码不会再 import。
  - 新增 `export { MissionControl } from "../MissionControl"`（barrel 桥接）。
- [ ] `src/components/MissionControl/MissionControl.tsx` 完成与 AppImpl 的对接：
  - props: `{ projects, repositories, initialTarget, onClose }`。
  - 进入时若 `initialTarget` 指定 → 自动 `actions.reset`。
  - PRD 空 → 自动打开 Setup Drawer。
  - 顶部"返回主界面"按钮（`onClose`）。

**验证**：

```bash
bun test
bunx tsc --noEmit
```

**手动验证清单（提交给用户）**：

1. 点 FAB → 出现 Mission Control 全屏，左 Sidebar 不被遮挡。
2. 首次打开自动弹 Setup Drawer。
3. 粘贴 PRD → 进入 planning 阶段，三列展示需求/任务图谱/空证据。
4. 点需求 → 任务卡片正确高亮。
5. 点任务 → 右侧证据面板出现 PRD 锚点 + 代码锚点。
6. 主 CTA 生成任务 → cluster runs 推进；状态 chip 显示"准备中 / 执行中 / 已完成"。
7. 落盘 → 进入 done 阶段；CTA = "打开执行编排"，事件可被 WorkflowConfigModal 接住。
8. 打开"高级 · 工程细节"抽屉，看到 cluster id / parentTaskName / validation / diff 等。
9. 关闭 Mission Control → 回到原工作区。

**回退点**：把 AppImpl 中 `missionControlMode = true` 改为 `false` 默认；恢复 `PrdSplitWizardHost` 内的 modal mount（保留代码）。回退点 ≤ 10 行。

---

## Step 5 · 词汇巡查、删旧测试残留、最终验证

- [ ] 在 `src/components/MissionControl/{header,canvas,details,setup}/` 内 grep 禁词：
  ```bash
  grep -rnE "\b(cluster|Cluster|dirty|unchanged|validation|verifier|normalized|parentTaskName|repoId|workflowId|run_dir|splitter|trellis-splitter|textHash)\b" \
      src/components/MissionControl/header src/components/MissionControl/canvas \
      src/components/MissionControl/details src/components/MissionControl/setup
  ```
  期望为空（identifiers 内出现允许，但用户面字面量 / JSX 文本不允许；逐条排查）。
- [ ] 在 `src/components/MissionControl/copy.ts` 与 `engineering/`、`legacy/` 内允许出现（这些是工程细节出口与移植的旧组件）。
- [ ] 全量测试：`bun test`。
- [ ] 类型检查：`bunx tsc --noEmit`。
- [ ] grep 旧入口：`grep -rn "PrdSplitWizardModal" src/ --include='*.ts' --include='*.tsx'`，确认除 `PrdSplitWizard/PrdSplitWizardModal.tsx`、`PrdSplitWizard/index.ts`（@deprecated）外无其它消费方。
- [ ] 把 `PrdSplitWizard/stages/` 中已经全部由 MissionControl 替代的文件移到 `PrdSplitWizard/_legacy_stages/`（不删除，方便 Phase B 拆完后整体删），并在 `PrdSplitWizard/index.ts` 头部加注释指向 Phase B 任务。
- [ ] 更新 `.trellis/spec/frontend/index.md`（若指向了旧 wizard 的章节）的引用，**仅在 spec 直接引用旧 stage 文件时才改**。

**最终交付**：

- 全部 acceptance criteria 勾选完毕（见 prd.md §5）。
- 新增 ≥ 2 个测试文件（`projectMission.test.ts`、`statusModel.test.ts`、`useMissionPresenter.test.ts`）。
- 旧 modal 文件标 deprecated 但保留。
- 触发的截图 / 录屏由用户提供。

---

## 关键风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `runCluster` thunk 抽离后 IPC 错误处理遗漏 | dispatch 阶段失败时 UI 卡住 | 完整搬迁 try/catch；保留 `splitterDispatch.test.ts`；新加 thunk 级单测 |
| selection 与 reducer phase 切换竞态 | 切换后选中态错乱 | selection 在 MissionControl 内的 state；阶段变化时根据 viewModel 自动 clamp |
| 视觉自适应不足 | 窄屏出现横向滚动 | 用 `clamp()` + `min-width: 0`；窗口 < 1180 折右列到抽屉 |
| 旧测试断言旧文案 | bun test 失败 | 巡检 `src/components/PrdSplitWizard/**/*.test.{ts,tsx}` 看是否断言用户面字符串；通常 reducer / pure 测试不会 |

## 顺序总结

1. Step 1：纯函数 + 类型 + 测试。
2. Step 2：UI 组件树（未挂载）。
3. Step 3：抽屉。
4. Step 4：AppImpl 接入 + 旧 modal 退役。
5. Step 5：词汇巡查 + 最终验证。

预计 5 步合计 ~ 25 个文件新建、~ 6 个文件修改、~ 1100 行净增（含 ~200 行测试）。
