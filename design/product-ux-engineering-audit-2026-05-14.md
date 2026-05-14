# Wise Product / UX / Engineering Audit

> Date: 2026-05-14
> Scope: desktop workspace shell, Claude sessions, left sidebar, PRD splitting entry points, visual consistency, and maintainability.
> Constraint: PRD split pipeline implementation is intentionally left untouched because another agent is actively working there.

## Core Conclusion

Wise's largest friction is not one isolated UI defect. The current workspace exposes several powerful systems at once: chat sessions, PRD splitting, Trellis pipeline, MCP, skills, terminal, Git, monitor panels, and workflow controls. The product needs a clearer primary route for each user job, and the code needs fewer global booleans coordinating overlapping modes.

## Strategic Fit: Claude Code + Trellis Auto-Driving R&D

The PRD split artifact pipeline is directionally aligned with Wise's intended product thesis:

> Claude Code as the execution substrate, Trellis as the development workflow spine, Wise as the visual desktop control tower for requirements, tasks, agents, orchestration, traceability, and near-autonomous delivery.

The current pipeline is a strong foundation because it moves PRD splitting out of a long chat session and into an auditable artifact pipeline:

1. PRD becomes `requirements-index.json`.
2. Requirements become repo/role clusters.
3. Each cluster is dispatched to a short-lived `trellis-splitter` agent.
4. Splitter output goes through strict local validation and normalization.
5. Tasks are written into `.trellis/tasks/` through the Trellis task API.
6. Existing workflow adapters can later dispatch `trellis-implement` and `trellis-check` through Claude Code worktrees.

This is the right skeleton for "auto-driving development". However, it is not yet the full auto-driving loop. It currently covers **requirements-to-task materialization** better than it covers **task-to-code-to-verification-to-learning**.

### What is already conceptually right

- Short-lived agents are scoped correctly. `trellis-splitter` is not a general planner or implementer; it has one job and emits machine-checkable JSON.
- The pipeline preserves replay data in `~/.wise/prd-runs/`, which is essential for audit and debugging.
- The split result carries requirement links, anchors, mappings, and cluster metadata, which supports traceability.
- `trellisWriter` uses `task.py` instead of directly writing task internals, keeping Trellis as the source of truth.
- Workflow execution already has a Trellis adapter for `trellis-implement` / `trellis-check`, worktree isolation, and progress artifacts.

### Where it still falls short of the thesis

1. **Entry model is too narrow**

   Requirements splitting must work for floating repositories, single-repo projects, and multi-repo projects. Multi-repo only changes the clustering step; it should not be the eligibility boundary.

2. **One PRD should have a visible top-level mission**

   The current design trends toward one parent task per cluster. That is useful internally, but product traceability needs a top-level PRD/mission parent that owns all cluster parents or child tasks. Otherwise one user requirement fragments into several unrelated Trellis parents.

3. **The loop stops too early**

   After "Write to Trellis", the product should offer an explicit orchestration plan: which tasks can run now, which need approval, which repos/worktrees will be used, and which check/eval gates will run. Writing tasks is not yet auto-driving.

4. **Concurrency needs a control plane**

   Cluster dispatch currently maps naturally to parallel subagents. That is good, but the product needs a visible concurrency budget, queue, cancel/retry controls, and per-agent status. Unlimited `Promise.all` style dispatch is operationally risky once PRDs get large.

5. **Traceability must extend beyond tasks**

   Requirement → task is only half the chain. The product thesis needs:

   - requirement → task
   - task → agent run
   - agent run → worktree / branch / changed files
   - changed files → tests / type checks / screenshots
   - verification → final task status
   - failure → retry / learning artifact

6. **Verifier should become a normal gate, not an emergency tool**

   `trellis-verifier` only being available on validation failure is useful, but automatic development needs normal evaluation gates: split quality, task executability, implementation quality, regression risk, and final acceptance.

7. **Desktop capabilities are not yet fully used as automation inputs**

   Wise can own terminal, Git, file browser, notifications, local app opening, and monitor surfaces. These should feed the workflow automatically: run commands, collect outputs, attach diffs, open previews, capture failures, and route them back to the right agent.

### Product direction

Treat PRD split as **Stage 0: Mission Planning**, not as a standalone feature.

The ideal Wise flow should read:

1. User gives a PRD or intent.
2. Wise creates a mission with requirements, clusters, task graph, and trace anchors.
3. Wise proposes an execution plan with concurrency, agent roles, repo/worktree allocation, and verification gates.
4. User approves the plan or edits it.
5. Wise launches implement/check agents under observable control.
6. Wise collects code diffs, test results, screenshots/logs, and verification decisions.
7. Wise updates Trellis tasks and keeps the full chain replayable.

That flow matches the stated product vision much more strongly than a separate "requirements split" tool.

## P0

### 1. Requirements splitting is incorrectly treated as a multi-repo-only job

**Why it feels bad**

A standalone frontend repository still needs requirements splitting. Single-repo work still needs PRD decomposition, acceptance criteria, execution order, and task sizing. Multi-repo only adds one extra question: which repository or role owns each task.

If the product implies "requirements split exists only after a project has multiple repositories", a user working on a frontend-only app is forced into chat even though the job is still structured planning.

**Evidence**

- `src/services/prdSplit/clusterPlanner.ts` already supports single-repo splitting with `repositories.length === 1`.
- `src/components/PrdSplitWizard/PrdSplitWizardModal.tsx` filters wizard targets to projects with `rootPath`, which excludes floating repositories as first-class split targets.
- `src/components/LeftSidebar/repositoryRows.tsx` exposes chat for floating repositories, but does not give the same clear requirements split affordance.

**Direction**

Model requirements splitting around the current work target:

- Floating repository: split PRD against that one repository.
- Single-repo project: split PRD against that project/repository context.
- Multi-repo project: split PRD, then cluster tasks by repository/role.

The pipeline should not require users to create or join a multi-repo project just to split requirements for one frontend repository.

### 2. PRD splitting has competing entry points

**Why it feels bad**

Users see more than one "requirements split" path, but the product does not explain which one is canonical. The old PRD task panel and the newer Trellis Artifact Pipeline look like two products with overlapping names.

**Evidence**

- `src/App.tsx` renders both `AppImpl` and `PrdSplitWizardHost`.
- `src/AppImpl.tsx` opens the legacy `taskSplitMode` from repository/project actions.
- `src/components/ClaudeSessions/ClaudeChat.tsx` opens the task split panel from the chat footer.
- `src/components/PrdSplitWizard/Host.tsx` adds a permanent floating button for the Trellis pipeline.

**Direction**

Make one canonical "Requirements Split" entry. Keep Trellis pipeline details behind an advanced section instead of a separate floating entry point.

### 3. Workspace modes are scattered across independent booleans

**Why it feels bad**

The main surface can be replaced by prompts, covered by MCP, covered by skills, or covered by PRD split. Users do not get a strong sense of current mode or how to return.

**Evidence**

- `src/AppImpl.tsx` owns `taskSplitMode`, `promptsMode`, `mcpHubMode`, and `skillsHubMode`.
- `src/components/AppWorkspaceLayout.tsx` renders multiple overlays in the chat/right-pane area.

**Direction**

Replace independent booleans with a single workspace mode model such as `chat | requirements | prompts | mcp | skills`. Show the active mode in the shell and make exit behavior consistent.

### 4. `AppImpl` remains the cross-feature coordination bottleneck

**Why it feels bad**

Product changes in one area can affect unrelated areas because selection state, global panels, sessions, workflow config, employees, and PRD state are coordinated in one large component.

**Evidence**

- `src/AppImpl.tsx` is about 1,900 lines.
- Its initial state block mixes mode flags, layout, project split templates, employee config, workflow config, dual pane, terminal, and search.

**Direction**

Extract named controllers: workspace mode, sidebar selection, PRD panel routing, and employee/workflow config routing. Do not keep growing `AppImpl` for feature-local behavior.

## P1

### 4. Left sidebar hides important actions behind hover-only controls

**Why it feels bad**

The project row contains expand, pin, more, requirements, and add actions. Several controls are hidden until hover, so new users cannot discover key actions by scanning the UI.

**Evidence**

- `src/components/LeftSidebar/ProjectRepositoryList.tsx` renders many row-level actions on one line.
- `src/App.css` hides `.app-repository-action` by default with `opacity: 0` and `pointer-events: none`.

**Direction**

Expose one primary row action and place secondary actions in a stable menu. Use text where the action is business-critical, especially "Requirements".

### 5. Multi-repo projects hide repository chat without explaining the routing model

**Why it feels bad**

The hidden repository chat action is semantically correct for project-owned Trellis routing, but the user can read it as "this repo cannot chat".

**Evidence**

- `src/components/LeftSidebar/ProjectRepositoryList.tsx` sets `hideChatAction` when the workspace mode resolves to `multi_repo`.

**Direction**

In multi-repo project mode, explicitly explain that users should chat from the project main session and route work by role tag or repository member.

### 6. Empty states are not executable enough

**Why it feels bad**

The current empty states tell the user what is missing but do not consistently offer the next action.

**Evidence**

- `src/components/ClaudeSessions/index.tsx` previously rendered only "please select a repository" or "select a session to start".

**Direction**

Empty states should provide direct actions: open search, create session, retry secondary session, or open the relevant workflow surface.

### 7. PRD Split Wizard exposes internal implementation vocabulary

**Why it feels bad**

The wizard uses terms like `cluster`, `trellis-splitter`, `normalizer`, `validation`, and `.trellis/tasks`. This is useful for maintainers but noisy for product users.

**Evidence**

- `src/components/PrdSplitWizard/PrdSplitWizardModal.tsx`
- `src/components/PrdSplitWizard/stages/InputStage.tsx`
- `src/components/PrdSplitWizard/stages/ClusterPlanStage.tsx`
- `src/components/PrdSplitWizard/stages/SplitsStage.tsx`
- `src/components/PrdSplitWizard/stages/ReviewStage.tsx`

**Direction**

Default language should describe user goals: input requirements, check grouping, generate tasks, write to workflow. Keep implementation details collapsible.

### 7.1 Terminology cleanup for the split flow

For developers, the current flow is easier to understand if the UI says:

- `cluster` → `任务分组`
- `dirty` → `有变化`
- `unchanged` → `可沿用`
- `splitter` → `生成任务`
- `Review` → `审阅与手工调整`
- `parent task` → `父任务`

The Trellis mapping is:

1. `PRD` 输入
2. 任务分组
3. 生成任务
4. 审阅与手工调整
5. 写入 `.trellis/tasks/`

This is not a Trellis core phase name change. It is only the wizard's product language, aligned to Trellis phase 2 execution flow.

### 8. The legacy PRD task panel is too dense for first-pass review

**Why it feels bad**

One screen combines PRD editing, task review, task editing, anchor inspection, AI optimization, executable checks, saving, and task generation.

**Evidence**

- `src/components/PrdTaskSplitPanel/PrdTaskSplitPanelImpl.tsx` uses a fixed two-column editor/result layout.
- `src/components/PrdTaskSplitPanel/TaskCard.tsx` embeds rich task editing and multiple execution actions in each task card.

**Direction**

Separate task review from task editing. Show a compact read-only list first, then open a detail/editor surface for optimization, checks, and generation.

## P2

### 9. Run action can open an unexpected default URL

**Why it feels bad**

If logs do not expose a URL quickly, the app opens a fallback URL after a timer. This can surprise users when the default port is wrong.

**Evidence**

- `src/components/ClaudeSessions/index.tsx` infers port `16088` and opens the fallback URL after 4.5 seconds.

**Direction**

Make the target URL explicit on first run, then remember the project-level preference.

### 10. Visual system still feels stitched together

**Why it feels bad**

Ant Design is the default system, while the composer retains Semi UI. The bridge works but still leaves focus and token seams that need active management.

**Evidence**

- `.trellis/spec/frontend/index.md` says Ant Design is default and Semi is retained only for the Claude composer.
- `src/components/ClaudeChatInput/composer-region.tsx` contains a focus workaround for Semi `AIChatInput`.

**Direction**

Keep Semi scoped to the composer, but normalize spacing, focus, popover, button, and token behavior against the app shell.

### 11. Dark mode is dead state

**Why it feels bad**

The code has a dark-mode state, but no active user path appears to change it.

**Evidence**

- `src/AppImpl.tsx` initializes `const [dark, _setDark] = useState(false);`.

**Direction**

Either remove the dead state and settle on light mode, or implement a complete theme switch.

### 12. Some recovery failures are silent

**Why it feels bad**

When session tabs, project lists, or repository lists fail to load, the user can land in an empty UI without a clear recovery path.

**Evidence**

- `src/services/tabsStore.ts` returns `null` or ignores failures.
- `src/components/PrdSplitWizard/Host.tsx` silently ignores project/repository refresh failures.

**Direction**

Use visible recoverable errors for user-facing loading failures: message, retry action, and diagnostic logging.

## Recommended Execution Order

1. Consolidate the two requirements-splitting entry points.
2. Make requirements splitting support floating repositories, single-repo projects, and multi-repo projects as equal first-class targets.
3. Introduce a single workspace mode model.
4. Make session and project empty states executable.
5. Simplify the left sidebar action hierarchy.
6. Reduce `AppImpl` by extracting one controller at a time.
