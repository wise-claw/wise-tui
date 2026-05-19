# Trellis 深度逆推（分享备忘）

> 目标：从 `.trellis/`、`.claude/hooks/`、agent 定义、CLI 脚本里逆推 Trellis 的真实运行机制；为 Wise 接下来的"Trellis-native 助手 / 工作台"集成方向提供决策依据。
> 真值源：本仓库 `mindfold-ai/Trellis` 落盘文件（README 没讲的部分以代码证据为准）。

---

## 0. 一句话总览

Trellis 把"AI 编程"从**提示词工程**重写成**文件系统编排 + Hook 注入**：
任务、规范、研究全部以文件为载体；每轮对话由三层 hook 现挑现塞，**AI 几乎不依赖会话记忆**，因此能在 14 个 AI 编码平台上跑同一套行为。

它的核心赌注：

1. **Spec 是注入的，不是记忆的**（`workflow.md` 第 8 行 Core Principles 第 2 条）。
2. **一切持久化**——对话会被 compact，文件不会。
3. **同一套结构覆盖 14 个平台**：Claude Code / Cursor / Codex / Gemini / Qoder / CodeBuddy / Droid / Kiro / Kilo / OpenCode / Antigravity / Windsurf / Copilot / Pi。

---

## 1. `trellis init` 落盘：仓库 + 平台两份配置

### 1.1 仓库内（共享、可入库）

```
.trellis/
├── config.yaml              # session_auto_commit / packages / hooks / codex.dispatch_mode
├── workflow.md              # 工作流"宪法" + [workflow-state:STATUS] 标签块（hook 真值源）
├── .developer               # gitignored，对应 trellis init -u <name>
├── .version
├── .template-hashes.json    # `trellis update` 用的增量哈希
├── scripts/
│   ├── task.py              # 任务 CLI（create/start/finish/archive/add-context/...）
│   ├── add_session.py       # 写 journal，超 2000 行轮转
│   ├── get_context.py       # --mode packages / --mode phase --step X.Y
│   └── common/              # active_task.py / paths.py / config.py / tasks.py / ...
├── spec/                    # 规范库；index.md 是入口（Pre-Development Checklist + Quality Check）
├── tasks/                   # MM-DD-<slug>/ 一个任务一个目录
├── workspace/<dev>/         # journal-N.md（≤2000 行轮转）+ index.md
└── .runtime/sessions/       # 每个 AI 会话/窗口一个 <context-key>.json
```

### 1.2 平台目录（每个平台一份，但 hook 是同一份 Python）

```
.claude/
├── settings.json            # SessionStart / PreToolUse(Task,Agent) / UserPromptSubmit 钩子声明
├── hooks/
│   ├── session-start.py             # 一次性"开机简报"
│   ├── inject-workflow-state.py     # 每轮"面包屑"
│   └── inject-subagent-context.py   # sub-agent 上下文拼装机
├── agents/
│   ├── trellis-implement.md         # Recursion Guard + Context Loading Protocol
│   ├── trellis-check.md
│   ├── trellis-research.md
│   └── trellis-{splitter,verifier}.md
├── commands/trellis/
│   ├── continue.md
│   └── finish-work.md
└── skills/                          # trellis-brainstorm / before-dev / check / break-loop / update-spec / meta
```

`.cursor/`、`.codex/`、`.gemini/`、`.qoder/`、`.codebuddy/`、`.factory/`（Droid）、`.kiro/`、`.copilot/` 同结构。
**关键**：`inject-workflow-state.py` 注释明说："Written to each platform's hooks directory via `writeSharedHooks()` at init time" —— 同一份脚本被复制到每个平台的 hooks 目录，靠 `_detect_platform()` 区分行为。

---

## 2. 三层 Hook：上下文注入的全部秘密

`.claude/settings.json` 挂的三个 hook：

```json
"SessionStart"     → session-start.py             (matcher: startup / clear / compact)
"PreToolUse"       → inject-subagent-context.py   (matcher: Task / Agent)
"UserPromptSubmit" → inject-workflow-state.py
```

### 2.1 SessionStart：一次性开机简报（`session-start.py:721-823`）

每次会话启动 / `/clear` / 自动 compact 时跑一次。输出一段 `additionalContext`，结构：

```
<session-context>            一句话总览
<first-reply-notice>         首回复约束（让 AI 用中文报到一次）
<migration-warning>          只在检测到旧版 spec 平铺结构时出现
<current-state>              Developer / Git 状态 / 当前 task / journal 行数
<trellis-workflow>           workflow.md 的 Phase Index 紧凑版
<guidelines>                 当前 scope 下可读的 spec index 列表
<task-status>                STATUS + 在场的 artifacts + Next-Action
<ready>
```

#### 三个不显眼但关键的副作用

1. **`_persist_context_key_for_bash`**（239-248 行）：往 `CLAUDE_ENV_FILE` 追加 `export TRELLIS_CONTEXT_ID=...`，让 AI 之后在 Bash 里跑 `task.py start` 时能拿到同一个 session 身份——否则 `task.py` 不知道"是哪个窗口"。
2. **`_resolve_spec_scope`**（506-562 行）：monorepo 下按 `active_task.package → default_package → 全量` 优先级裁剪 spec scope；frontend 任务不会被塞 backend 规范。
3. **`_check_legacy_spec`**：检测旧版 `spec/backend/`、`spec/frontend/` 平铺结构并发迁移警告。

### 2.2 UserPromptSubmit：每轮面包屑（`inject-workflow-state.py:303-359`）

每次用户发消息前跑。**workflow.md 是唯一真值源**，hook 没有兜底字典：

```python
_TAG_RE = re.compile(
    r"\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n(.*?)\n\s*\[/workflow-state:\1\]",
    re.DOTALL,
)
```

#### STATUS 取值（`workflow.md:120-134` 的契约注释）

| STATUS | 阶段范围 |
|---|---|
| `no_task` | 还没建任务 |
| `planning` | Phase 1 全程 |
| `in_progress` | Phase 2 + Phase 3.1-3.4（task.py archive 之前不变） |
| `completed` | 当前是死代码（archive 同时移走目录，pointer 失效） |
| `*-inline` | Codex inline 模式的并行变体 |

→ 你改 `workflow.md` 里某个标签块，**14 个平台下一轮 prompt 立刻拿到新文本**。

#### 平台差异处理

- **Gemini CLI 0.40.x** 把这个事件改名 `BeforeAgent`，schema 校验拒掉旧名字 → hook 在 348-350 行用 `_detect_platform()` 切换 `hookEventName`。
- **Codex** 没有完整 SessionStart 通道：
  - 没 active task 时插 `<trellis-bootstrap>` 提醒读 `trellis-start` skill。
  - 加 `<codex-mode>` 横幅显式告诉 AI 当前 `dispatch_mode`，因为 Codex sub-agent 用 `fork_turns="none"` 隔离，不能继承父 session 的 task 上下文。

### 2.3 PreToolUse(Task/Agent)：sub-agent 上下文拼装机

`inject-subagent-context.py`，**Trellis 最核心的发明**。

#### 主流程（687-767 行）

1. 解析 hook input，归一化多平台格式：
   - Claude/Qoder/CodeBuddy/Droid：`tool_input.subagent_type`
   - Cursor：protobuf oneof（`{"custom": {"name": ...}}` 或 `{"type": {"case": "custom", "value": {...}}}`）
   - Copilot：`toolName` 是 camelCase
   - Gemini：直接把 agent 名当 tool name
   - Kiro：`agentSpawn` hook 在顶层放 `agent_name`
2. 仅对 `trellis-implement` / `trellis-check` / `trellis-research` 三个白名单生效。
3. 通过 `resolve_active_task` 拿到当前任务目录。
4. 按 agent 类型读对应 jsonl + 任务 artifacts 拼上下文。
5. 用 `build_implement_prompt` / `build_check_prompt` / `build_research_prompt`（351-460 行）把原始 prompt 包进完整模板。
6. 输出 `permissionDecision: allow` + `updatedInput`，**直接改写发给 sub-agent 的提示词**。

#### JSONL 契约（190-256 行）

```jsonl
{"file": "path/to/spec.md", "reason": "why this file is in context"}
{"file": "path/to/dir/", "type": "directory", "reason": "scan all .md in dir"}
{"_example": "..."}                # 种子行，无 file 字段 → 静默跳过
```

`task.py create` 时种一个 `_example` 占位。AI 在 Phase 1 通过 `task.py add-context` 增 curated 行。**Trellis 拒绝"全部塞进去再说"**——这是它和很多工作流的核心区别。

#### `<!-- trellis-hook-injected -->` 双轨契约

拼装好的 prompt 第一行就是这个标记。`agents/trellis-implement.md:21-24` 和 `trellis-check.md` 里告诉 sub-agent：

- **看到标记** → hook 跑过了，直接干活。
- **没看到** → hook 因 Windows / `--continue` / 平台 fork 没起作用，从 dispatch prompt 第一行 `Active task: <path>` 自己读 jsonl。

→ Hook 是首选，但 agent 自己也能拉。这是 Trellis 设计成熟度的标志。

#### 多平台输出协议（752-763 行）

```python
output = {
    "hookSpecificOutput": {              # Claude / Qoder / CodeBuddy / Droid
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": updated,
    },
    "permission": "allow",                # Cursor 风格
    "updated_input": updated,             # Cursor snake_case
    "updatedInput": updated,              # Gemini camelCase
}
```

每个平台只读它认识的字段，其余忽略。**比一份一份写适配层简洁得多。**

---

## 3. 任务生命周期：从纸面到磁盘的 24 个动作

以本项目当前任务 `.trellis/tasks/05-18-assistant-hub-builtin-prd-split/` 为样本：

```
05-18-assistant-hub-builtin-prd-split/
├── task.json           # status / assignee / priority / branch / package / parent / children / scope
├── prd.md              # 需求与验收（Phase 1 brainstorm 产物）
├── design.md           # 技术设计（complex 任务必需）
├── implement.md        # 执行清单（complex 任务必需）
├── implement.jsonl     # implement sub-agent 的 spec 清单
├── check.jsonl         # check sub-agent 的 spec 清单
└── research/           # trellis-research 落盘的 .md（按需）
```

### 3.1 Phase 1: Plan（`workflow.md:314-461`）

| 步骤 | 动作 | 文件级效果 |
|---|---|---|
| 1.0 | `task.py create` | 建 `MM-DD-<slug>/`；写 `task.json{status:planning}`；种 `prd.md` 模板；为 sub-agent-capable 平台种 `implement.jsonl`/`check.jsonl` 占位行；如有 session 身份顺手写 `.runtime/sessions/<key>.json` |
| 1.1 | 加载 `trellis-brainstorm` skill | **一次问一个问题**，每答一个就回写 `prd.md`；复杂任务再写 `design.md` + `implement.md` |
| 1.2 | 派发 `trellis-research` sub-agent | 落盘到 `<task>/research/<topic>.md`；**只能写 research/，禁止改代码或 spec**（agent 定义里硬约束） |
| 1.3 | 配置上下文 | `task.py add-context <task> implement <file> "<reason>"` 往 jsonl 追加 |
| 1.4 | `task.py start <task>` | `task.json.status: planning → in_progress`；`.runtime/sessions/<key>.json.current_task = <task>` |

### 3.2 Phase 2: Execute（`workflow.md:463-557`）

主会话拿到 `<workflow-state>` 显示 `in_progress`，按面包屑 dispatch sub-agent：

```
trellis-implement → PreToolUse hook 拼上下文 → 执行
trellis-check     → PreToolUse hook 拼上下文 → 自修复 + lint/typecheck
```

**Recursion guard**（`agents/trellis-{implement,check}.md:11-17`）：sub-agent 自己看到面包屑里说"dispatch implement/check"也不能再 spawn。**只有主会话有派发权**。

### 3.3 Phase 3: Finish（`workflow.md:558-643`）

```
3.1 trellis-check 终检（带 [finish] 标记，hook 切到 build_finish_prompt 模板）
3.2 trellis-break-loop 调试复盘（按需）
3.3 trellis-update-spec  把新认知写回 .trellis/spec/
3.4 git commit（用户确认后；workflow-state-contract 强制）
3.5 /trellis:finish-work → task.py archive：
       status → completed
       目录搬到 archive/{YYYY-MM}/
       runtime session 文件清掉
       add_session.py 把会话标题/commit/摘要追加到 journal-N.md
```

---

## 4. 多 runtime 集成：抹平差异的 5 个手段

### 4.1 平台检测 = 环境变量 + sys.argv 兜底

```python
env_map = {
    "CLAUDE_PROJECT_DIR": "claude",
    "CURSOR_PROJECT_DIR": "cursor",
    "CODEBUDDY_PROJECT_DIR": "codebuddy",
    "FACTORY_PROJECT_DIR": "droid",
    "GEMINI_PROJECT_DIR": "gemini",
    "QODER_PROJECT_DIR": "qoder",
    "KIRO_PROJECT_DIR": "kiro",
    "COPILOT_PROJECT_DIR": "copilot",
}
# fallback: 看 sys.argv[0] 路径里的 .claude / .cursor / .codex / ...
```

### 4.2 Hook 输出 = 多格式并集（见 §2.3）

### 4.3 Active Task = 会话身份解析的洋葱（`active_task.py:380-415`）

```
TRELLIS_CONTEXT_ID（显式覆盖，CLI 子进程用）
  ↓
hook input 里的 session_id / conversation_id / transcript_path
  ↓
平台原生 env：CLAUDE_SESSION_ID / CODEX_SESSION_ID / CURSOR_SESSION_ID / ...
  ↓
Cursor 30s shell ticket（_lookup_cursor_shell_ticket_context_key）
  ↓
单 session fallback：.runtime/sessions/ 下只有一个文件就用它
  ↓
ActiveTask(None) — 拒绝跨窗口猜测
```

每个 session 一个 `<context-key>.json`：

```json
{
  "platform": "claude",
  "last_seen_at": "2026-05-18T07:11:19Z",
  "current_task": ".trellis/tasks/05-18-assistant-hub-builtin-prd-split",
  "current_run": null
}
```

→ **同一仓库 3 个 Claude 窗口，每个有自己的 active task**。这是 README 完全没讲、产品级体验最重要的一条。

### 4.4 Sub-agent 隔离差异：Class-1 vs Class-2

| 类别 | 平台 | 行为 |
|---|---|---|
| Class-1 | Claude / Cursor / Qoder / CodeBuddy / Droid / Kiro / Copilot / Gemini / Pi | sub-agent 继承父 session id；PreToolUse hook 拦得到；标准 dispatch |
| Class-2 | Codex / Kilo / Antigravity / Windsurf | `fork_turns="none"` 完全隔离；走 inline 模式 |

`config.yaml` 的 `codex.dispatch_mode`：
- `inline`（默认）：主 agent 自己编辑代码；用 `[workflow-state:planning-inline]` / `[workflow-state:in_progress-inline]` 并行标签块。
- `sub-agent`：兼容旧模式，依赖单 session fallback 才能工作。

`workflow.md:281-295` 的"Active Task Routing"明确把 Kilo / Antigravity / Windsurf 也归到 inline 类别。

### 4.5 Workflow.md 标签块 = 跨平台真值源

- 没有兜底字典，故意让坏掉立刻可见。
- `trellis update` 做 block-level managed replacement，把上游模板增量推到下游项目。
- 改一处，14 个平台下一轮立即生效。

---

## 5. 几个非显然的设计决策（明天值得讲的梗）

1. **Hook 是边界，不是装饰**。AI 不再"记住"什么，行为完全卸载到 3 个 hook 的输出。即使会话被 compact、即使切换平台，行为是连续的。
2. **JSONL 是手工 curate 的，不是自动生成的**。Trellis 拒绝"全塞进去"——那会污染上下文。Brainstorm skill 在 Phase 1 期间陪 AI 选什么进 jsonl。
3. **Recursion guard 写在 agent prompt 里**。`trellis-implement.md` 的 Recursion Guard 段落是产品契约，不依赖 hook 拦截——sub-agent 看到面包屑也不能再 spawn。
4. **首回复"中文报到"**。`FIRST_REPLY_NOTICE` 用一次性提醒强制让 AI 显式说一句"上下文已加载"，给开发者一个确认信号。这是产品体验里很轻但很有效的一招。
5. **Active task 是 session-scoped 的**。3 个窗口 3 个 active task。`task.py create` 时如果有 session 身份就直接绑当前会话，省掉手动 `start`。
6. **Spec 沉淀是闭环的**：Phase 3 的 `trellis-update-spec` 把这一轮认知写回 spec；下一轮 Plan 时 brainstorm 把它选回 jsonl 注入给 implement。**Spec 库越用越厚，规范越来越精确**。
7. **`<!-- trellis-hook-injected -->` 双轨**：hook 拼好就是首选；hook 没起作用 agent 也知道自己读 jsonl。**容错不靠运气**。
8. **Workspace journal 按开发者隔离**。`.trellis/workspace/<dev>/journal-N.md` 每人一份，超 2000 行轮转。Spec 入库共享，journal 独立——避免协作冲突。

---

## 6. 对 Wise 集成的启示（决策依据）

### 6.1 Wise 当前的位置

`workflow.md:158-174` 的"Wise Requirement Assistant Sandbox"段落已经写进 Trellis 工作流里——这意味着 **Wise 是 Trellis 的"上游"**：在 `.trellis/tasks/` 真正生成之前，Wise 提供一个可视化的需求 / PRD / 拆分沙箱。

落地路径已经定了：
1. Intake：手工 PRD / 导入 PRD / 历史会话 / 用户笔记 → 归一化。
2. Split：可审核的候选任务（**不派 implement agent**）。
3. Anchor：每个候选任务映射回 PRD 原文片段。
4. Human review：编辑 PRD / 任务 / 依赖 / anchor / 验收。
5. Handoff：用户显式确认后才落 `.trellis/tasks/<task>/` 并进入 splitter dispatch pipeline。

### 6.2 集成原则（从逆推得到）

| Trellis 设计 | Wise 该怎么对齐 |
|---|---|
| 文件系统是真值源 | Wise 沙箱状态最终也要能 dump 成 `.trellis/tasks/` 的目录结构；候选任务用 jsonl + md 同形态承载 |
| Hook 决定每轮行为 | Wise 别在 prompt 里塞规则；要么也写 hook，要么把规则写进 spec 让 hook 自然挑出来 |
| JSONL 手工 curate | Wise 的"任务-spec 映射"应该让用户/AI 在沙箱里 curate，落盘时直接生成 implement.jsonl/check.jsonl |
| Active task 是 session-scoped | Wise UI 的"当前任务"概念应该和 `.runtime/sessions/<key>.json` 对齐，而不是全局单例 |
| Recursion guard 写在 prompt | Wise 派发时也要带上 dispatch prompt 的首行 `Active task: <path>`，让落到 sub-agent 的提示符合 Trellis 双轨契约 |
| 平台差异靠 detect_platform | Wise 如果支持多 runtime，要复用 Trellis 的检测逻辑，而不是自己重写 |
| Spec 沉淀闭环 | Wise 收尾要驱动 `trellis-update-spec`，否则规范不会越用越厚 |

### 6.3 不要做的事

- **不要在 Wise 里维护一份独立的"任务模型"**——会和 `.trellis/tasks/` 漂移。沙箱阶段是临时态，正式态以 task 目录为准。
- **不要绕过 hook 自己塞 prompt**——会破坏跨平台一致性。要塞就塞进 spec / workflow.md / jsonl。
- **不要为 Wise 单独写 sub-agent 调度**——直接复用 `inject-subagent-context.py` 的契约，Wise 只负责发起 Task tool call。
- **不要把 PRD 的可视化编辑做成"覆盖文件"**——要做成 git-friendly 的增量编辑，因为 Trellis 假设 spec 入库 + journal 独立。

### 6.4 可以做的差异化

- **可视化 anchor**：Trellis 命令行没有这个能力。Wise 把 candidate task ↔ PRD 原文片段的映射做成图形化是真增量。
- **跨任务依赖图**：`.trellis/tasks/` 里有 parent/children 字段但没有可视化。Wise 可以把它做成 DAG。
- **Run history 回放**：`.runtime/sessions/<key>.json` 现在只存当前任务；Wise 可以扩展存执行轨迹做回放。
- **Spec 库浏览**：Trellis 的 spec/index.md 是入口但没 UI。Wise 把它做成可搜索 / 可关联任务的浏览器。

---

## 7. 分享时可以挑的几个"反直觉"切入点

1. **"AI 编程的瓶颈不是模型能力，是上下文调度"** —— Trellis 把这件事做成基础设施。
2. **"一份 hook 喂 14 个平台"** —— 输出多协议并集 + 平台检测，不靠适配层。
3. **"Spec 是注入的不是记忆的"** —— compact 不丢，跨平台不丢，跨会话不丢。
4. **"sub-agent 提示词由 hook 改写"** —— PreToolUse 直接拦截 Task tool call，把 jsonl 内容拼进去。
5. **"Recursion guard 写在 prompt 里"** —— sub-agent 看到面包屑也不能再 spawn，优雅。
6. **"Active task 是 session 的"** —— 3 窗口 3 任务，互不干扰。
7. **"Spec 沉淀闭环"** —— 越用越厚，规范越来越精确，是真正的"复利"。

---

## 8. 关键代码位置速查

| 主题 | 文件 | 行号 |
|---|---|---|
| Hook 声明 | `.claude/settings.json` | 5-71 |
| SessionStart 主流程 | `.claude/hooks/session-start.py` | 721-823 |
| 把 context-key 写入 CLAUDE_ENV_FILE | 同上 | 239-248 |
| Spec scope 解析 | 同上 | 506-562 |
| UserPromptSubmit 主流程 | `.claude/hooks/inject-workflow-state.py` | 303-359 |
| `[workflow-state:STATUS]` 解析正则 | 同上 | 169-172 |
| Codex inline mode 处理 | 同上 | 250-272, 337-343 |
| PreToolUse 主流程 | `.claude/hooks/inject-subagent-context.py` | 687-767 |
| JSONL 读取契约 | 同上 | 190-256 |
| 多平台输出协议 | 同上 | 752-763 |
| 平台检测 | 同上 | 82-113 |
| Active task 解析 | `.trellis/scripts/common/active_task.py` | 380-415, 468-494 |
| 单 session fallback | 同上 | 497-519 |
| Cursor shell ticket | 同上 | 257-377 |
| Workflow 真值源契约 | `.trellis/workflow.md` | 99-141 注释 |
| 标签块（每个 STATUS 一个） | 同上 | 184-267 |
| Active Task Routing | 同上 | 277-295 |
| `task.py start` | `.trellis/scripts/task.py` | 70-140 |
| `task.py finish` | 同上 | 143-161 |
| trellis-brainstorm skill | `.claude/skills/trellis-brainstorm/SKILL.md` | 全文 |
| trellis-implement agent | `.claude/agents/trellis-implement.md` | 全文，重点 11-24 |
| Wise sandbox 契约 | `.trellis/workflow.md` | 158-174 |
