import type { CollabAgentBinding, CollabAgentStatus } from "../../types/collaboration";

/** 输入框接收者候选：智能体 + 其绑定仓库。 */
export interface CollabRecipientAgent {
  id: string;
  name: string;
  status: CollabAgentStatus;
  bindings: CollabAgentBinding[];
}

export interface CollabRecipientRepository {
  id: number;
  name: string;
  roleTags: string[];
}

export type CollabRecipientMatchKind = "agent" | "repository" | "role";

export interface CollabRecipientCandidate {
  agentId: string;
  agentName: string;
  matchKind: CollabRecipientMatchKind;
  matchLabel: string;
  repositoryId: number | null;
}

export interface CollabRecipientParse {
  /** `@` 后的原始名；无 @ 前缀时为 null。 */
  token: string | null;
  /** 去掉 @接收者 前缀后的正文。 */
  body: string;
  candidates: CollabRecipientCandidate[];
  /** 唯一匹配时的智能体；零个或多个时为 null（多个时需用户选择）。 */
  resolvedAgentId: string | null;
  ambiguous: boolean;
}

const MENTION_RE = /^\s*@(?:"([^"]+)"|(\S+))\s*/u;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function activeBindings(agent: CollabRecipientAgent): CollabAgentBinding[] {
  return agent.bindings.filter((b) => b.status === "active");
}

/**
 * 按「智能体名 → 仓库名 → 角色标签」顺序匹配；前一层有结果即停止，避免仓库名与角色撞名时混淆。
 * 仅已启用的智能体可成为接收者。
 */
export interface CollabRecipientMatchOptions {
  /** 限定命名空间；默认三类都匹配。 */
  kinds?: readonly CollabRecipientMatchKind[];
  /** 允许匹配未启用的智能体（讨论模式可用）；默认仅已启用。 */
  includeDisabled?: boolean;
}

export function matchCollabRecipients(
  token: string,
  agents: readonly CollabRecipientAgent[],
  repositories: readonly CollabRecipientRepository[],
  options: CollabRecipientMatchOptions = {},
): CollabRecipientCandidate[] {
  const q = norm(token);
  if (!q) return [];
  const kinds = new Set(options.kinds ?? ["agent", "repository", "role"]);
  const enabled = agents.filter(
    (a) => a.status === "enabled" || (options.includeDisabled === true && a.status !== "archived"),
  );

  const byAgent = (kinds.has("agent") ? enabled : [])
    .filter((a) => norm(a.name) === q || a.id === token)
    .map<CollabRecipientCandidate>((a) => ({
      agentId: a.id,
      agentName: a.name,
      matchKind: "agent",
      matchLabel: a.name,
      repositoryId: null,
    }));
  if (byAgent.length) return byAgent;

  const repoIds = kinds.has("repository") ? repositories.filter((r) => norm(r.name) === q).map((r) => r.id) : [];
  if (repoIds.length) {
    const out: CollabRecipientCandidate[] = [];
    for (const repoId of repoIds) {
      const bound = enabled
        .map((a) => ({ a, b: activeBindings(a).filter((b) => b.repositoryId === repoId) }))
        .filter((x) => x.b.length > 0);
      const defaults = bound.filter((x) => x.b.some((b) => b.isDefault));
      for (const { a } of defaults.length ? defaults : bound) {
        out.push({ agentId: a.id, agentName: a.name, matchKind: "repository", matchLabel: token, repositoryId: repoId });
      }
    }
    return dedupe(out);
  }

  if (!kinds.has("role")) return [];
  const repoRoles = new Map(repositories.map((r) => [r.id, r.roleTags.map(norm)]));
  const byRole: CollabRecipientCandidate[] = [];
  for (const a of enabled) {
    for (const b of activeBindings(a)) {
      const tags = [...b.roleTags.map(norm), ...(repoRoles.get(b.repositoryId) ?? [])];
      if (tags.includes(q)) {
        byRole.push({ agentId: a.id, agentName: a.name, matchKind: "role", matchLabel: token, repositoryId: b.repositoryId });
      }
    }
  }
  return dedupe(byRole);
}

function dedupe(list: CollabRecipientCandidate[]): CollabRecipientCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (seen.has(c.agentId)) return false;
    seen.add(c.agentId);
    return true;
  });
}

/** 解析输入框开头的 `@接收者`（支持 `@"带空格的名字"`）。 */
export function parseCollabRecipient(
  text: string,
  agents: readonly CollabRecipientAgent[],
  repositories: readonly CollabRecipientRepository[],
  options: CollabRecipientMatchOptions = {},
): CollabRecipientParse {
  const m = MENTION_RE.exec(text);
  if (!m) return { token: null, body: text.trim(), candidates: [], resolvedAgentId: null, ambiguous: false };
  const token = (m[1] ?? m[2] ?? "").trim();
  const body = text.slice(m[0].length).trim();
  const candidates = matchCollabRecipients(token, agents, repositories, options);
  return {
    token,
    body,
    candidates,
    resolvedAgentId: candidates.length === 1 ? candidates[0].agentId : null,
    ambiguous: candidates.length > 1,
  };
}

/** `@` 补全建议：前缀匹配智能体名、仓库名与角色标签。 */
export function suggestCollabRecipients(
  prefix: string,
  agents: readonly CollabRecipientAgent[],
  repositories: readonly CollabRecipientRepository[],
  limit = 8,
): { label: string; kind: CollabRecipientMatchKind }[] {
  const q = norm(prefix);
  const out: { label: string; kind: CollabRecipientMatchKind }[] = [];
  const seen = new Set<string>();
  const push = (label: string, kind: CollabRecipientMatchKind) => {
    const key = `${kind}:${norm(label)}`;
    if (seen.has(key) || !norm(label).startsWith(q)) return;
    seen.add(key);
    out.push({ label, kind });
  };
  const enabled = agents.filter((a) => a.status === "enabled");
  for (const a of enabled) push(a.name, "agent");
  const boundRepoIds = new Set(enabled.flatMap((a) => activeBindings(a).map((b) => b.repositoryId)));
  for (const r of repositories) if (boundRepoIds.has(r.id)) push(r.name, "repository");
  for (const a of enabled) for (const b of activeBindings(a)) for (const t of b.roleTags) push(t, "role");
  return out.slice(0, limit);
}

/** 生成可插入输入框的 mention 文本。 */
export function formatCollabMention(label: string): string {
  return /\s/.test(label) ? `@"${label}" ` : `@${label} `;
}
