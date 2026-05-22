import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  estimateContextPercent,
  estimateSessionTokens,
  type SessionContextMetrics,
} from "./claudeSessionContext";
import { getClaudeMcpStatus, listClaudeProjectSkills, listClaudeSubagents } from "./claude";
import { readProjectRelativeFile } from "./materializePrdSnapshot";
import type { ClaudeSession } from "../types";

/** 与 Claude Code `/context` 面板相近的分类（UI 估算，非官方计数）。 */
export type ContextBreakdownCategoryId =
  | "systemPrompt"
  | "toolDefinitions"
  | "rules"
  | "skills"
  | "mcp"
  | "subagents"
  | "conversation";

export interface ContextBreakdownCategory {
  id: ContextBreakdownCategoryId;
  label: string;
  tokens: number;
  color: string;
}

export interface ContextBreakdownSnapshot {
  maxTokens: number;
  totalTokens: number;
  ctxPercent: number;
  categories: ContextBreakdownCategory[];
  /** 是否为基于本地配置的估算（非 Claude `/context` 实测）。 */
  estimated: boolean;
}

/** Claude Code 内置系统提示 + 工具 schema 的典型基线（约数，用于空会话展示）。 */
const BASELINE_SYSTEM_PROMPT_TOKENS = 2_700;
const BASELINE_TOOL_DEFINITIONS_TOKENS = 12_000;
const TOKENS_PER_MCP_TOOL = 48;
const MCP_SERVER_OVERHEAD_TOKENS = 180;

const CATEGORY_META: Record<
  ContextBreakdownCategoryId,
  { label: string; color: string }
> = {
  systemPrompt: { label: "系统提示词", color: "#8c8c8c" },
  toolDefinitions: { label: "工具定义", color: "#9254de" },
  rules: { label: "规则", color: "#52c41a" },
  skills: { label: "技能", color: "#d4b106" },
  mcp: { label: "MCP", color: "#eb2f96" },
  subagents: { label: "子代理定义", color: "#1677ff" },
  conversation: { label: "对话", color: "#fa8c16" },
};

export function estimateTokensFromCharCount(charCount: number): number {
  return Math.max(0, Math.round(charCount / 4));
}

export function formatContextTokenCount(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${Math.round(n / 1_000)}K`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}K`;
  }
  return n.toLocaleString("zh-CN");
}

async function readOptionalProjectText(repositoryPath: string, relativePath: string): Promise<string> {
  try {
    return await readProjectRelativeFile(repositoryPath, relativePath);
  } catch {
    return "";
  }
}

export interface ContextOverheadEstimate {
  systemPrompt: number;
  toolDefinitions: number;
  rules: number;
  skills: number;
  mcp: number;
  subagents: number;
}

export async function loadContextOverheadEstimate(
  repositoryPath: string,
): Promise<ContextOverheadEstimate> {
  const trimmed = repositoryPath.trim();
  if (!trimmed) {
    return {
      systemPrompt: BASELINE_SYSTEM_PROMPT_TOKENS,
      toolDefinitions: BASELINE_TOOL_DEFINITIONS_TOKENS,
      rules: 0,
      skills: 0,
      mcp: 0,
      subagents: 0,
    };
  }

  const [claudeMd, agentsMd, skills, subagents, mcpStatus] = await Promise.all([
    readOptionalProjectText(trimmed, "CLAUDE.md"),
    readOptionalProjectText(trimmed, "AGENTS.md"),
    listClaudeProjectSkills(trimmed).catch(() => []),
    listClaudeSubagents(trimmed).catch(() => []),
    getClaudeMcpStatus(trimmed).catch(() => null),
  ]);

  const rulesChars =
    claudeMd.length +
    agentsMd.length +
    (await readOptionalProjectText(trimmed, ".cursor/rules/AGENTS.md")).length;

  let skillsChars = 0;
  for (const skill of skills) {
    skillsChars += (skill.description ?? "").length + skill.name.length * 8;
    if (skill.hasSkillMd) skillsChars += 400;
  }

  let subagentChars = 0;
  for (const agent of subagents) {
    subagentChars +=
      agent.name.length +
      agent.description.length +
      agent.tools.join(",").length +
      (agent.memory?.length ?? 0) +
      120;
  }

  let mcpToolCount = 0;
  let mcpServerCount = 0;
  if (mcpStatus) {
    const buckets = [
      mcpStatus.user,
      mcpStatus.local,
      mcpStatus.projectShared,
      mcpStatus.legacyUserSettings,
      mcpStatus.legacyProjectSettings,
      mcpStatus.pluginMcp,
    ];
    for (const items of buckets) {
      for (const item of items) {
        if (!item.enabled) continue;
        mcpServerCount += 1;
        mcpToolCount += item.tools.length;
      }
    }
  }

  return {
    systemPrompt: BASELINE_SYSTEM_PROMPT_TOKENS,
    toolDefinitions: BASELINE_TOOL_DEFINITIONS_TOKENS,
    rules: estimateTokensFromCharCount(rulesChars),
    skills: estimateTokensFromCharCount(skillsChars),
    mcp: mcpServerCount * MCP_SERVER_OVERHEAD_TOKENS + mcpToolCount * TOKENS_PER_MCP_TOOL,
    subagents: estimateTokensFromCharCount(subagentChars),
  };
}

function buildCategory(
  id: ContextBreakdownCategoryId,
  tokens: number,
): ContextBreakdownCategory {
  const meta = CATEGORY_META[id];
  return { id, label: meta.label, tokens: Math.max(0, Math.round(tokens)), color: meta.color };
}

export function buildContextBreakdownSnapshot(
  session: ClaudeSession,
  overhead: ContextOverheadEstimate,
  metrics?: SessionContextMetrics,
  maxContextTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): ContextBreakdownSnapshot {
  const conversationTokens = estimateSessionTokens(session);
  const overheadTotal =
    overhead.systemPrompt +
    overhead.toolDefinitions +
    overhead.rules +
    overhead.skills +
    overhead.mcp +
    overhead.subagents;
  const totalTokens = Math.max(conversationTokens + overheadTotal, metrics?.estimatedTokens ?? 0);
  const ctxPercent =
    metrics?.ctxPercent ?? estimateContextPercent(totalTokens, maxContextTokens);

  return {
    maxTokens: maxContextTokens,
    totalTokens,
    ctxPercent,
    estimated: true,
    categories: [
      buildCategory("systemPrompt", overhead.systemPrompt),
      buildCategory("toolDefinitions", overhead.toolDefinitions),
      buildCategory("rules", overhead.rules),
      buildCategory("skills", overhead.skills),
      buildCategory("mcp", overhead.mcp),
      buildCategory("subagents", overhead.subagents),
      buildCategory("conversation", conversationTokens),
    ],
  };
}
