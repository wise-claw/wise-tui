import type { CollabDispatchMode, CollabSessionRequirement } from "../../types/collaboration";
import { parseCollabRecipient, type CollabRecipientAgent } from "./recipients";

/** 输入框的需求关联选择：自动（按会话绑定判断）/ 强制新需求 / 继续指定需求。 */
export type CollabComposerTarget = { kind: "auto" } | { kind: "new" } | { kind: "continue"; requirementId: string };

export interface CollabComposerSelection {
  agentId: string | null;
  mode: CollabDispatchMode;
  target: CollabComposerTarget;
}

export const DEFAULT_COLLAB_COMPOSER_SELECTION: CollabComposerSelection = {
  agentId: null,
  mode: "execute",
  target: { kind: "auto" },
};

export type CollabComposerIntentDecision =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | {
      kind: "dispatch";
      agentId: string;
      mode: CollabDispatchMode;
      body: string;
      requirementId: string | null;
      /** 从文本 @ 解析出的接收者：调用方可写回选择，后续发送沿用。 */
      fromMention: boolean;
    };

function isLiveRequirement(r: CollabSessionRequirement): boolean {
  return r.requirement.controlStatus !== "cancelled" && r.requirement.businessStatus !== "done";
}

/** 会话中可“继续”的需求：原会话发起且仍在进行的需求。 */
export function continuableSessionRequirements(list: readonly CollabSessionRequirement[]): CollabSessionRequirement[] {
  return list.filter((r) => r.relation === "origin" && isLiveRequirement(r));
}

/**
 * 发送前决定是否走仓库智能体派发。
 * - 文本以 `@智能体名` 开头时按智能体命名空间解析（不匹配仓库/角色，保留原 @仓库 行为）；
 * - 否则沿用该会话已选择的接收者；都没有时返回 none，走原有发送链路。
 * 讨论模式不关联需求；多条进行中需求且未明确选择时要求用户选择，不盲目续办。
 */
export function decideCollabComposerIntent(params: {
  text: string;
  selection: CollabComposerSelection;
  agents: readonly CollabRecipientAgent[];
  sessionRequirements: readonly CollabSessionRequirement[];
}): CollabComposerIntentDecision {
  const { selection, agents } = params;
  const text = params.text.trim();
  let agentId = selection.agentId;
  let body = text;
  let fromMention = false;

  if (text.startsWith("@") || text.startsWith("＠")) {
    const normalized = text.startsWith("＠") ? `@${text.slice(1)}` : text;
    const parsed = parseCollabRecipient(normalized, agents, [], {
      kinds: ["agent"],
      includeDisabled: selection.mode === "discuss",
    });
    if (parsed.ambiguous) {
      return { kind: "error", message: `有多个名为「${parsed.token}」的智能体，请在接收者中选择` };
    }
    if (parsed.resolvedAgentId) {
      agentId = parsed.resolvedAgentId;
      body = parsed.body;
      fromMention = agentId !== selection.agentId;
    }
  }
  if (!agentId) return { kind: "none" };
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return { kind: "error", message: "所选智能体不存在或已归档，请重新选择接收者" };
  if (!body) return { kind: "error", message: "请输入要交给智能体的内容" };

  if (selection.mode === "discuss") {
    return { kind: "dispatch", agentId, mode: "discuss", body, requirementId: null, fromMention };
  }
  if (agent.status !== "enabled") {
    return { kind: "error", message: `智能体「${agent.name}」未启用，只能使用讨论模式` };
  }

  let requirementId: string | null = null;
  const target = selection.target;
  if (target.kind === "continue") {
    const found = params.sessionRequirements.find((r) => r.requirement.id === target.requirementId);
    if (found?.requirement.controlStatus === "cancelled") {
      return { kind: "error", message: "该需求已取消，请先在需求卡片中重新打开" };
    }
    requirementId = target.requirementId;
  } else if (target.kind === "auto") {
    const live = continuableSessionRequirements(params.sessionRequirements).filter(
      (r) => r.requirement.ownerAgentId === agentId,
    );
    if (live.length > 1) {
      return { kind: "error", message: "当前会话有多条进行中的需求，请选择“继续”的需求或“新需求”" };
    }
    requirementId = live[0]?.requirement.id ?? null;
  }
  return { kind: "dispatch", agentId, mode: selection.mode, body, requirementId, fromMention };
}
