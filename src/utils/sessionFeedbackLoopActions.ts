export type FeedbackLoopStructuredActionKind =
  | "compact"
  | "disable_mcp"
  | "composer_phrase"
  | "apply_patch"
  | "generic";

export interface FeedbackLoopStructuredAction {
  id: string;
  kind: FeedbackLoopStructuredActionKind;
  label: string;
  detail?: string;
  patchId?: string;
}

const ACTION_SECTION_MARKERS = ["立即执行清单", "可执行动作", "下一步"];

function slugId(text: string): string {
  return text.replace(/\s+/g, "-").slice(0, 48) || "action";
}

function extractActionSection(text: string): string[] {
  const lines = text.split("\n");
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inSection && ACTION_SECTION_MARKERS.some((m) => trimmed.includes(m))) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^#{1,3}\s/.test(trimmed) && !ACTION_SECTION_MARKERS.some((m) => trimmed.includes(m))) {
        break;
      }
      if (trimmed) out.push(trimmed);
    }
  }
  if (out.length > 0) return out;
  return lines.map((l) => l.trim()).filter(Boolean).slice(-12);
}

function classifyActionLine(line: string): FeedbackLoopStructuredActionKind {
  const lower = line.toLowerCase();
  if (lower.includes("/compact") || line.includes("压缩上下文") || line.includes("执行 compact")) {
    return "compact";
  }
  if (/disable.*mcp|禁用.*mcp|关闭.*mcp server/i.test(line)) {
    return "disable_mcp";
  }
  if (line.includes("常用语") || line.includes("composer") || line.includes("写入习惯")) {
    return "composer_phrase";
  }
  if (line.includes("配置补丁") || line.includes("apply patch") || line.includes("应用补丁")) {
    return "apply_patch";
  }
  return "generic";
}

/** 从 worker 优化响应解析可执行动作（规则 + 编号列表）。 */
export function parseFeedbackLoopStructuredActions(
  responseText: string,
  options?: {
    pendingPatchIds?: readonly string[];
  },
): FeedbackLoopStructuredAction[] {
  const text = responseText.trim();
  if (!text) return [];

  const lines = extractActionSection(text);
  const actions: FeedbackLoopStructuredAction[] = [];
  let index = 0;

  for (const raw of lines) {
    const line = raw.replace(/^[-*•\d.)\]]+\s*/, "").trim();
    if (line.length < 4) continue;
    if (/^#{1,6}\s/.test(line)) continue;

    const kind = classifyActionLine(line);
    const patchId =
      kind === "apply_patch" && options?.pendingPatchIds?.length
        ? options.pendingPatchIds[0]
        : undefined;

    actions.push({
      id: `action-${index}-${slugId(line)}`,
      kind,
      label: line.length > 120 ? `${line.slice(0, 117)}…` : line,
      detail: line,
      patchId,
    });
    index += 1;
    if (actions.length >= 8) break;
  }

  if (actions.length === 0 && /\/compact/.test(text)) {
    actions.push({
      id: "action-compact-inline",
      kind: "compact",
      label: "执行 /compact 压缩上下文",
      detail: "/compact",
    });
  }

  return actions;
}

/**
 * 判定一条配置补丁是否属于「非破坏性」、可被自动落盘的低风险补丁。
 *
 * 保守扩展策略：仅放行追加类与可回滚的禁用类动作，覆盖面与安全性兼顾。
 *  - `append_section`：向已存在文件（CLAUDE.md / rules / memory）追加章节，不覆盖既有内容；
 *  - `mcp` + `disable`：禁用 MCP server，可经备份一键回滚。
 *
 * 明确排除（需人工审阅）：`create`（新建文件）、`update`（覆盖）、`merge_json`（改写 settings）、
 * `enable`（启用 MCP，可能引入新副作用）。
 */
export function isLowRiskAutoApplyPatch(input: {
  kind: string;
  action: string;
  source: string;
}): boolean {
  if (input.action === "append_section") return true;
  if (input.kind === "mcp" && input.action === "disable") return true;
  return false;
}
