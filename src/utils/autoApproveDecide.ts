import type { PermissionRequest, QuestionRequest } from "../types";

/**
 * Wise 「自动批准」模式。
 * - `off`：不自动应答，所有 PermissionRequest / QuestionRequest 走人工 dock。
 * - `plans`：仅计划批准（ExitPlanMode）自动 allow；文件编辑与其它工具仍弹 dock；不影响 question。
 * - `edits`：文件编辑类工具与计划批准（ExitPlanMode）自动 allow，其它仍弹 dock；不影响 question。
 * - `all`：全部 PermissionRequest 自动 allow；AskUserQuestion 自动选首项 / 全选 (multiSelect)。
 */
export type AutoApproveMode = "off" | "plans" | "edits" | "all";

/**
 * 与 Claude Code 官方 `acceptEdits` 行为对齐的「编辑类」工具白名单。
 * 仅这些工具在 `mode === "edits"` 下会被自动 allow。
 *
 * 注：刻意只列出 Anthropic 官方文档化的工具名；第三方 MCP 注册的同名/相近工具
 * 不会出现在此白名单——避免恶意 MCP 借用「Edit」名义绕过用户审批。
 */
export const EDIT_AUTO_APPROVE_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/** Claude Code 规划模式退出确认（计划批准）；`edits` 模式下与编辑类工具一并自动 allow。 */
export const PLAN_AUTO_APPROVE_TOOLS: ReadonlySet<string> = new Set(["ExitPlanMode"]);

/**
 * 把任意字符串归一化为合法 mode；非法值（例如 app_setting 历史脏值）一律降级为 `"off"`，
 * 防止意外开启自动批准。
 */
export function normalizeAutoApproveMode(raw: unknown): AutoApproveMode {
  if (raw === "plans" || raw === "edits" || raw === "all" || raw === "off") return raw;
  return "off";
}

/**
 * 判定一个 PermissionRequest 是否要被 Wise 自动 allow。
 *
 * - 命中 → 返回 `"allow_once"`，调用方应直接调 `respondToPermission(sessionId, "allow_once")`。
 * - 未命中 → 返回 `null`，调用方不动，保留 dock 兜底。
 *
 * 规则：
 * - `mode === "off"` → 始终 null。
 * - `mode === "plans"` → 仅当 `request.tool` 命中 `PLAN_AUTO_APPROVE_TOOLS` 才 allow_once。
 * - `mode === "edits"` → 当 `request.tool` 命中 `EDIT_AUTO_APPROVE_TOOLS` 或
 *   `PLAN_AUTO_APPROVE_TOOLS` 才 allow_once。
 * - `mode === "all"` → 始终 allow_once（无论 tool 是什么 / 控制子类型）。
 *   `controlSubtype` 不参与判定（permission / can_use_tool 均按工具白名单处理）。
 */
export function decidePermissionAutoApprove(
  mode: AutoApproveMode,
  request: Pick<PermissionRequest, "tool" | "controlSubtype">,
): "allow_once" | null {
  if (mode === "off") return null;
  if (mode === "all") return "allow_once";
  if (typeof request.tool !== "string" || request.tool.length === 0) return null;
  if (mode === "plans") {
    return PLAN_AUTO_APPROVE_TOOLS.has(request.tool) ? "allow_once" : null;
  }
  // mode === "edits"
  return EDIT_AUTO_APPROVE_TOOLS.has(request.tool) || PLAN_AUTO_APPROVE_TOOLS.has(request.tool)
    ? "allow_once"
    : null;
}

/**
 * 判定一个 QuestionRequest（AskUserQuestion）是否要被 Wise 自动应答。
 *
 * - 命中 → 返回 `{ answers, customAnswer }`，调用方应直接调
 *   `respondToQuestion(sessionId, answers, customAnswer)`。
 * - 未命中 → 返回 `null`。
 *
 * 规则（spec §QuestionRequest）：
 * - `mode === "off"` 或 `"plans"` 或 `"edits"` → 始终 null（编辑/计划类自动批准是 permission 范畴，question 留给人）。
 * - `mode === "all"` →
 *   - `options.length === 0` → 不自动应答（避免乱填空白）。
 *   - `multiSelect === true` → 自动选全部 options。
 *   - 其它（含 undefined / false） → 自动选首项。
 *   - `customAnswer` 永远为空。
 */
export function decideQuestionAutoApprove(
  mode: AutoApproveMode,
  request: Pick<QuestionRequest, "options" | "multiSelect">,
): { answers: string[]; customAnswer: string } | null {
  // 仅 "all" 模式自动应答 question；plans/edits 是 permission 范畴，question 留给人。
  if (mode !== "all") return null;
  const options = Array.isArray(request.options) ? request.options : [];
  if (options.length === 0) return null;

  const values = options
    .map((opt) => (opt && typeof opt.value === "string" ? opt.value : null))
    .filter((v): v is string => v !== null && v.length > 0);

  if (values.length === 0) return null;

  if (request.multiSelect === true) {
    // 多选必须全部 option 都有合法 value，否则回落到人工 dock：
    // 部分缺失的 multiSelect 自动答案会向 Claude 传递不对称的子集（语义不清晰）。
    if (values.length !== options.length) return null;
    return { answers: values, customAnswer: "" };
  }
  return { answers: [values[0]], customAnswer: "" };
}
