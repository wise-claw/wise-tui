# Wise 自动批准模式 — 实施计划

参见 `.omc/autopilot/spec.md`。

## 任务列表（按依赖顺序）

### T1 - 纯函数判定层（0 依赖，最先做）
**文件**：
- 新建 `src/utils/autoApproveDecide.ts`
- 新建 `src/utils/autoApproveDecide.test.ts`

**API**：
```ts
export type AutoApproveMode = "off" | "edits" | "all";

export function decidePermissionAutoApprove(
  mode: AutoApproveMode,
  request: Pick<PermissionRequest, "tool" | "controlSubtype">,
): "allow_once" | null;

export function decideQuestionAutoApprove(
  mode: AutoApproveMode,
  request: Pick<QuestionRequest, "options" | "multiSelect">,
): { answers: string[]; customAnswer: string } | null;

export const EDIT_AUTO_APPROVE_TOOLS: ReadonlySet<string>;  // Edit/Write/MultiEdit/NotebookEdit/Update
```

**测试**：覆盖 off/edits/all × Permission(Edit/Bash/MCP/ExitPlanMode) × Question(0 options/single/multi)。

---

### T2 - 设置存储层（依赖 T1 类型，无运行时依赖）
**文件**：
- 新建 `src/services/autoApproveSettings.ts`
- 新建 `src/services/autoApproveSettings.test.ts`

**API**：
```ts
const GLOBAL_KEY = "auto_approve_mode";
const REPO_KEY = (id: number) => `auto_approve_mode:repo:${id}`;

export async function getGlobalAutoApproveMode(): Promise<AutoApproveMode>;
export async function setGlobalAutoApproveMode(mode: AutoApproveMode): Promise<void>;
export async function getRepoAutoApproveOverride(repoId: number): Promise<AutoApproveMode | "inherit">;
export async function setRepoAutoApproveOverride(repoId: number, value: AutoApproveMode | "inherit"): Promise<void>;
export async function resolveEffectiveAutoApproveMode(repoId: number | null | undefined): Promise<AutoApproveMode>;
```

**实现**：直接走 `getAppSetting` / `setAppSetting` / `deleteAppSetting`（`src/services/appSettingsStore.ts` 已有）。校验非法字符串归一化为 `"off"`。

**测试**：mock appSettingsStore，覆盖默认/全局/仓库优先级、非法值降级。

---

### T3 - 自动应答钩子（运行时挂在通知 hub 后）
**改文件**：
- `src/hooks/useClaudeSessions.ts`

**改动**：
1. 在 `respondToPermission` / `respondToQuestion` useCallback 旁，新增一个 `useEffect` 订阅 hub，针对当前 `permissionRequest` / `questionRequest` 拉取 effective mode，调用 `decide*` 函数，命中时分别调 `respondToPermission(sessionId, "allow_once")` 或 `respondToQuestion(sessionId, answers, customAnswer)`。
2. 用 `Set<string>` 记忆已自动处理过的 requestId，避免同一题反复触发（hub 自身已做 lifecycle，但订阅多次激活时仍可能误重入）。
3. effective mode 取仓库 id 优先；session→repository 的映射沿用 hook 内已有 `session.repositoryId`。
4. 一条 `console.info("[wise:auto-approve] {tool|question} → allow_once")` 便于排查；不主动 toast（避免噪声）。

**注意**：`mode === "edits"` 不自动答 question；`mode === "all"` 时若 question 没有 options，仍不自动答（spec 已写）。

---

### T4 - 设置面板入口
**改文件**：
- 找到「应用设置」对话框入口（先 grep 一下 `app_settings\|应用设置\|AppSettingsModal`），加一栏 radio。
- 同时考虑在仓库设置（`EmployeeConfigModal` 或仓库专属设置面板）追加覆盖项。

**降级**：若入口找不到现成的合适位置，单独新建一个 `<AutoApproveSettingsBlock />` 组件，先暴露给开发者通过未来 PR 接入；T4 不阻塞 T1–T3 落地。

---

### T5 - Composer 状态徽章
**改文件**：
- `src/components/ClaudeChatInput/composer-region.tsx`

**改动**：在 composer 顶部已有 dock 区域旁增加一个 `<AutoApproveBadge mode={mode} />`：
- `off` → 不渲染
- `edits` → 黄色 tag「⚡ 自动批准: 仅编辑」
- `all` → 橙色 tag「⚡ 自动批准: 全部」+ tooltip 提示风险

**降级**：若 composer-region 文件过大改动困难，先在 `ClaudeChat.tsx` 顶部加一行轻量横幅。

---

### T6 - 验证
1. `bunx tsc --noEmit` → exit=0
2. 新增的 ts 文件单测 `bun test src/utils/autoApproveDecide.test.ts src/services/autoApproveSettings.test.ts` → 通过
3. `cd /Users/sjl/Documents/github/wise/src-tauri && $HOME/.cargo/bin/cargo test --lib claude_commands::terminal` → 通过（保持终端测试不被破坏，作 sanity check）

## 依赖图
```
T1 ── T3 ─┬─ T6
T2 ──┬────┘
     └─ T4
T5 (独立，可并行)
```

## 风险/回退
- T3 改的是核心 hook，要求改动范围最小：仅新增 useEffect，不改既有 callback 签名。
- 若钩子触发 race（PermissionRequest 还没在 hub 落地就被 setNull 覆盖），用 `requestId` 去重 + lifecycle status 判断 `pending` 即可。
- 若用户嫌「所有 question 自动选首项」太激进，spec 已限制为仅 `mode === "all"`，且默认 `off`。
