import type { ClaudeMessage, MessagePart, PermissionRequest } from "../types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

export function isExitPlanModeTool(name: unknown): boolean {
  return typeof name === "string" && name.trim() === "ExitPlanMode";
}

export function resolveControlRequestId(
  root: Record<string, unknown>,
  req: Record<string, unknown>,
): string | undefined {
  return (
    str(root.request_id)?.trim() ||
    str(root.requestId)?.trim() ||
    str(req.request_id)?.trim() ||
    str(req.requestId)?.trim()
  );
}

export function resolveControlToolInput(req: Record<string, unknown>): Record<string, unknown> {
  const raw = req.tool_input ?? req.toolInput ?? req.input;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function resolveControlToolUseId(req: Record<string, unknown>): string | undefined {
  return str(req.tool_use_id)?.trim() || str(req.toolUseId)?.trim() || str(req.toolUseID)?.trim();
}

export function buildPermissionDescription(
  toolName: string,
  explicit: string | undefined,
  toolInput: Record<string, unknown>,
): string {
  if (explicit?.trim()) return explicit.trim();
  if (isExitPlanModeTool(toolName)) {
    return "计划已写好。确认退出规划模式并开始执行后续操作？";
  }
  if (Object.keys(toolInput).length > 0) {
    return JSON.stringify(toolInput, null, 0).slice(0, 2000);
  }
  return "需要确认的工具调用";
}

export function buildPermissionRequestFromControl(
  root: Record<string, unknown>,
  req: Record<string, unknown>,
  controlSubtype: PermissionRequest["controlSubtype"],
): PermissionRequest | null {
  const requestId = resolveControlRequestId(root, req);
  if (!requestId) return null;
  const toolName = str(req.tool_name) ?? str(req.toolName) ?? "unknown";
  const toolInput = resolveControlToolInput(req);
  const explicitDescription =
    str(req.description) ?? str(req.title) ?? str(req.display_name) ?? str(req.displayName);
  return {
    id: requestId,
    tool: toolName,
    description: buildPermissionDescription(toolName, explicitDescription, toolInput),
    filePatterns: undefined,
    toolInput,
    toolUseId: resolveControlToolUseId(req),
    controlSubtype: controlSubtype ?? "permission",
  };
}

export function buildPermissionRequestFromToolUsePart(part: Extract<MessagePart, { type: "tool_use" }>): PermissionRequest | null {
  if (!isExitPlanModeTool(part.name)) return null;
  const requestId = typeof part.id === "string" ? part.id.trim() : "";
  if (!requestId) return null;
  const toolInput = asRecord(part.input) ?? {};
  return {
    id: requestId,
    tool: "ExitPlanMode",
    description: buildPermissionDescription("ExitPlanMode", undefined, toolInput),
    toolInput,
    toolUseId: requestId,
    controlSubtype: "can_use_tool",
  };
}

/** 控制行 id 优先于 tool_use id；保留 toolUseId 供 allow 回包。 */
export function mergePermissionRequestUpdate(
  current: PermissionRequest | null,
  incoming: PermissionRequest,
): PermissionRequest {
  if (!current) return incoming;
  if (current.tool !== incoming.tool) return incoming;
  if (current.id === incoming.id) {
    return {
      ...current,
      ...incoming,
      toolInput: Object.keys(incoming.toolInput ?? {}).length > 0 ? incoming.toolInput : current.toolInput,
      toolUseId: incoming.toolUseId ?? current.toolUseId,
    };
  }
  const incomingIsControlLine = incoming.controlSubtype === "can_use_tool" && incoming.id !== incoming.toolUseId;
  const currentIsToolUseFallback = current.toolUseId === current.id;
  if (incomingIsControlLine || currentIsToolUseFallback) {
    return {
      ...incoming,
      toolUseId: incoming.toolUseId ?? current.toolUseId ?? current.id,
    };
  }
  return incoming;
}

/** 从 transcript 找仍在 running 的 ExitPlanMode tool_use（Hub 丢失时的兜底）。 */
export function extractPendingExitPlanModeFromMessages(
  messages: readonly ClaudeMessage[],
): PermissionRequest | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j -= 1) {
      const part = msg.parts[j];
      if (part.type !== "tool_use") continue;
      if (part.status === "completed" || part.status === "error") continue;
      const built = buildPermissionRequestFromToolUsePart(part);
      if (built) return built;
    }
  }
  return null;
}
