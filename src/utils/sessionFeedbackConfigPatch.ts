import { mergeJsonPatchContent } from "./sessionFeedbackConfigPatchJson";
import { joinRepositoryAbsolutePath } from "./repositoryPreviewBinary";
import type { SessionInsightRecommendation, SessionInsightsResult } from "./sessionInsights";
import type { SessionInsightsReportMeta } from "./sessionInsightsReport";
import { buildFeedbackLoopMarkdownReport, type SessionFeedbackLoopState } from "./sessionFeedbackLoop";

/** Claude Code 持久配置面（反馈神经网可优化的 Artifact 类型）。 */
export type FeedbackConfigArtifactKind =
  | "claude_md"
  | "agents_md"
  | "rule"
  | "memory"
  | "mcp"
  | "skill"
  | "settings";

export type FeedbackConfigPatchAction =
  | "append_section"
  | "create"
  | "update"
  | "merge_json"
  | "enable"
  | "disable";

export type FeedbackConfigPatchSource = "heuristic" | "ai";
export type FeedbackConfigPatchStatus = "pending" | "applied" | "rejected" | "failed";

export interface FeedbackConfigPatchMcpMeta {
  serverName: string;
  scope: string;
  sourcePath: string;
  claudeJsonProjectKey?: string | null;
}

export interface FeedbackConfigPatch {
  id: string;
  kind: FeedbackConfigArtifactKind;
  action: FeedbackConfigPatchAction;
  /** 仓库根目录相对路径，如 `CLAUDE.md`、`.claude/rules/exploration.md` */
  path: string;
  section?: string;
  rationale: string;
  content: string;
  source: FeedbackConfigPatchSource;
  status: FeedbackConfigPatchStatus;
  mcp?: FeedbackConfigPatchMcpMeta;
  /** 应用前快照（审阅 diff 用） */
  contentBefore?: string;
  appliedAt?: number;
  errorMessage?: string;
}

export interface FeedbackConfigSnapshotFile {
  path: string;
  exists: boolean;
  charCount: number;
  excerpt: string;
}

export interface FeedbackConfigSnapshotSkill {
  name: string;
  hasSkillMd: boolean;
  description?: string;
}

export interface FeedbackConfigSnapshotMcp {
  name: string;
  enabled: boolean;
  scope: string;
  sourcePath: string;
  toolCount: number;
}

export interface FeedbackConfigSnapshotOverhead {
  rules: number;
  skills: number;
  mcp: number;
  subagents: number;
}

export interface FeedbackConfigOverheadDelta {
  rules: number;
  skills: number;
  mcp: number;
  subagents: number;
  capturedAt: number;
}

/** 仓库 Claude Code 配置快照，供优化 prompt 与补丁推断使用。 */
export interface FeedbackConfigSnapshot {
  repositoryPath: string;
  capturedAt: number;
  claudeMd: FeedbackConfigSnapshotFile;
  agentsMd: FeedbackConfigSnapshotFile;
  /** Claude Code 自动记忆入口（`~/.claude/projects/<project>/memory/MEMORY.md`） */
  memoryFile: FeedbackConfigSnapshotFile;
  settingsFile: FeedbackConfigSnapshotFile;
  ruleFiles: FeedbackConfigSnapshotFile[];
  skills: FeedbackConfigSnapshotSkill[];
  mcpServers: FeedbackConfigSnapshotMcp[];
  overhead: FeedbackConfigSnapshotOverhead;
}

const ARTIFACT_KIND_LABEL: Record<FeedbackConfigArtifactKind, string> = {
  claude_md: "CLAUDE.md",
  agents_md: "AGENTS.md",
  rule: "Rules",
  memory: "Memory",
  mcp: "MCP",
  skill: "Skill",
  settings: "Settings",
};

const MAX_RULE_FILES_IN_PROMPT = 6;

/** 反馈补丁落盘时用于标识 Claude Code 自动记忆文件（非仓库相对路径）。 */
export const CLAUDE_AUTO_MEMORY_PATCH_PATH = "__claude_auto_memory__/MEMORY.md";

export function feedbackConfigArtifactKindLabel(kind: FeedbackConfigArtifactKind): string {
  return ARTIFACT_KIND_LABEL[kind];
}

export function createFeedbackConfigPatchId(prefix = "patch"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 规范化 skill / memory 补丁路径。 */
export function resolveFeedbackConfigPatchPath(patch: FeedbackConfigPatch): FeedbackConfigPatch {
  const path = patch.path.trim();
  if (patch.kind === "skill") {
    if (path.endsWith("/SKILL.md") || path.endsWith("\\SKILL.md")) {
      return { ...patch, path: path.replace(/\\/g, "/") };
    }
    const skillId = path
      .replace(/^\.claude\/skills\//, "")
      .replace(/\/$/, "")
      .trim();
    if (skillId && !skillId.includes("/")) {
      return { ...patch, path: `.claude/skills/${skillId}/SKILL.md` };
    }
  }
  if (patch.kind === "memory") {
    if (
      path === "memory" ||
      path === "memory.md" ||
      path === "project-memory.md" ||
      path === ".claude/project-memory.md" ||
      path.startsWith("__claude_auto_memory__/")
    ) {
      return { ...patch, path: CLAUDE_AUTO_MEMORY_PATCH_PATH };
    }
    if (!path.startsWith(".claude/")) {
      return { ...patch, path: CLAUDE_AUTO_MEMORY_PATCH_PATH };
    }
  }
  if (patch.kind === "settings") {
    if (path === "settings" || path === "settings.json") {
      return { ...patch, path: ".claude/settings.json" };
    }
    if (!path.startsWith(".claude/")) {
      return { ...patch, path: `.claude/${path}` };
    }
  }
  return { ...patch, path };
}

export type FeedbackConfigPatchOpenKind = "repository_relative" | "absolute" | "memory" | "none";

export interface FeedbackConfigPatchFileTarget {
  fileName: string;
  displayPath: string;
  openKind: FeedbackConfigPatchOpenKind;
  repositoryRelativePath?: string;
  absolutePath?: string;
}

/** 解析补丁对应文件的展示名与路径（memory 类需异步 enrich 后才有绝对路径）。 */
export function resolveFeedbackConfigPatchFileTarget(
  patch: FeedbackConfigPatch,
  repositoryPath?: string | null,
): FeedbackConfigPatchFileTarget {
  const resolved = resolveFeedbackConfigPatchPath(patch);

  if (resolved.action === "enable" || resolved.action === "disable") {
    const sourcePath = resolved.mcp?.sourcePath?.trim() ?? "";
    const serverName = resolved.mcp?.serverName?.trim() || resolved.path;
    if (!sourcePath) {
      return { fileName: serverName, displayPath: resolved.path, openKind: "none" };
    }
    const fileName = sourcePath.split(/[/\\]/).pop() ?? serverName;
    return {
      fileName,
      displayPath: sourcePath,
      openKind: "absolute",
      absolutePath: sourcePath,
    };
  }

  if (resolved.path === CLAUDE_AUTO_MEMORY_PATCH_PATH) {
    return {
      fileName: "MEMORY.md",
      displayPath: "Claude 自动记忆 · MEMORY.md",
      openKind: "memory",
    };
  }

  const rel = resolved.path.replace(/\\/g, "/");
  const fileName = rel.split("/").pop() ?? rel;
  const repo = repositoryPath?.trim();
  if (!repo) {
    return {
      fileName,
      displayPath: rel,
      openKind: "none",
      repositoryRelativePath: rel,
    };
  }

  const absolutePath = joinRepositoryAbsolutePath(repo, rel);
  return {
    fileName,
    displayPath: absolutePath,
    openKind: "repository_relative",
    repositoryRelativePath: rel,
    absolutePath,
  };
}

function patchDedupeKey(patch: Pick<FeedbackConfigPatch, "kind" | "action" | "path" | "section">): string {
  return [patch.kind, patch.action, patch.path, patch.section ?? ""].join("|");
}

export function dedupeFeedbackConfigPatches(patches: readonly FeedbackConfigPatch[]): FeedbackConfigPatch[] {
  const seen = new Set<string>();
  const out: FeedbackConfigPatch[] = [];
  for (const patch of patches) {
    const key = patchDedupeKey(patch);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(patch);
  }
  return out;
}

function heuristicExplorationRule(rec: SessionInsightRecommendation): FeedbackConfigPatch {
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "rule",
    action: "create",
    path: ".claude/rules/feedback-loop-exploration.md",
    rationale: `[${rec.severity}] ${rec.title}：${rec.description}`,
    content: [
      "# 探索与工具使用（反馈神经网）",
      "",
      "- 先用 codegraph / 语义搜索一次定位，再 Read 具体文件",
      "- 避免同路径重复 Grep/Read",
      "- 独立探索任务优先 Task 子代理并行",
      "- 每轮先明确目标再调用工具，避免无目的广搜",
    ].join("\n"),
    source: "heuristic",
    status: "pending",
  };
}

function heuristicTokenDiscipline(rec: SessionInsightRecommendation): FeedbackConfigPatch {
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "claude_md",
    action: "append_section",
    path: "CLAUDE.md",
    section: "上下文与 Token 纪律",
    rationale: `[${rec.severity}] ${rec.title}：${rec.description}`,
    content: [
      "- 回复保持简洁，避免重复粘贴大段代码",
      "- 优先引用路径与行号，而非全文",
      "- 单轮合并探索步骤，减少往返",
      "- 稳定 system prompt，避免每轮动态大段前缀",
    ].join("\n"),
    source: "heuristic",
    status: "pending",
  };
}

function heuristicSettingsHooks(rec: SessionInsightRecommendation): FeedbackConfigPatch {
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "settings",
    action: "merge_json",
    path: ".claude/settings.json",
    rationale: `[${rec.severity}] ${rec.title}：通过 hooks 约束工具链长度`,
    content: JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: ".*",
              hooks: [
                {
                  type: "command",
                  command:
                    "echo '[feedback-loop] 合并重复探索，避免同轮无目的广搜'",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    source: "heuristic",
    status: "pending",
  };
}

function heuristicMemoryNote(rec: SessionInsightRecommendation): FeedbackConfigPatch {
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "memory",
    action: "append_section",
    path: CLAUDE_AUTO_MEMORY_PATCH_PATH,
    section: "会话经验",
    rationale: `[${rec.severity}] ${rec.title}：${rec.description}`,
    content: [
      "- 记录本仓库反复出现的失败模式与规避方式",
      "- 新会话优先读取本节再开始探索",
    ].join("\n"),
    source: "heuristic",
    status: "pending",
  };
}

function heuristicSpeedSection(rec: SessionInsightRecommendation): FeedbackConfigPatch {
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "claude_md",
    action: "append_section",
    path: "CLAUDE.md",
    section: "速度与并行",
    rationale: `[${rec.severity}] ${rec.title}：${rec.description}`,
    content: [
      "- 可并行的 Read/Grep/搜索应同轮批量发起",
      "- 缩小单轮探索范围，先窄后宽",
      "- 长链路任务拆分为可验证的小步",
    ].join("\n"),
    source: "heuristic",
    status: "pending",
  };
}

function heuristicRulesTrim(snapshot: FeedbackConfigSnapshot): FeedbackConfigPatch | null {
  if (snapshot.overhead.rules < 2500) return null;
  return {
    id: createFeedbackConfigPatchId("heuristic"),
    kind: "claude_md",
    action: "append_section",
    path: "CLAUDE.md",
    section: "规则维护",
    rationale: `rules 估算约 ${snapshot.overhead.rules} tokens，建议审查 .claude/rules 是否冗长或与 CLAUDE.md 重复`,
    content: [
      "- 定期审查 `.claude/rules/`，删除重复条目",
      "- 项目级约定优先写入 CLAUDE.md，专题规则才放 rules",
    ].join("\n"),
    source: "heuristic",
    status: "pending",
  };
}

/** 从洞察与配置快照推断可审阅的配置补丁候选（规则引擎，不依赖 AI）。 */
export function inferConfigPatchCandidates(input: {
  insights: SessionInsightsResult;
  snapshot?: FeedbackConfigSnapshot | null;
}): FeedbackConfigPatch[] {
  const patches: FeedbackConfigPatch[] = [];

  for (const rec of input.insights.recommendations) {
    if (rec.category === "tool") {
      patches.push(heuristicExplorationRule(rec));
      patches.push(heuristicSettingsHooks(rec));
    } else if (rec.category === "token") {
      patches.push(heuristicTokenDiscipline(rec));
    } else if (rec.category === "speed") {
      patches.push(heuristicSpeedSection(rec));
    } else if (rec.category === "reliability" || rec.category === "observability") {
      patches.push(heuristicMemoryNote(rec));
    }
  }

  if (input.snapshot) {
    const trim = heuristicRulesTrim(input.snapshot);
    if (trim) patches.push(trim);

    const disabledMcp = input.snapshot.mcpServers.filter((s) => !s.enabled);
    if (disabledMcp.length > 0 && input.insights.toolHotspots.some((h) => h.name.includes("MCP"))) {
      const target = disabledMcp[0];
      if (target) {
        patches.push({
          id: createFeedbackConfigPatchId("heuristic"),
          kind: "mcp",
          action: "enable",
          path: target.sourcePath,
          rationale: "洞察显示 MCP 相关工具热点，但部分 MCP server 未启用",
          content: "",
          source: "heuristic",
          status: "pending",
          mcp: {
            serverName: target.name,
            scope: target.scope,
            sourcePath: target.sourcePath,
          },
        });
      }
    }
  }

  if (patches.length === 0) {
    patches.push({
      id: createFeedbackConfigPatchId("heuristic"),
      kind: "claude_md",
      action: "append_section",
      path: "CLAUDE.md",
      section: "Claude Code 工作习惯",
      rationale: "会话洞察未命中专项规则，沉淀通用工具使用习惯",
      content: [
        "- 每轮先明确目标再调用工具",
        "- 探索 → 执行 → 验证三步闭环",
        "- 优先复用已有 skills / MCP，而非重复造轮子",
      ].join("\n"),
      source: "heuristic",
      status: "pending",
    });
  }

  return dedupeFeedbackConfigPatches(patches).slice(0, 8);
}

export function formatConfigSnapshotMarkdown(snapshot: FeedbackConfigSnapshot): string[] {
  const lines: string[] = [
    "## 当前仓库 Claude Code 配置快照",
    "",
    `- **CLAUDE.md**：${snapshot.claudeMd.exists ? `${snapshot.claudeMd.charCount} 字符` : "不存在"}`,
    `- **AGENTS.md**：${snapshot.agentsMd.exists ? `${snapshot.agentsMd.charCount} 字符` : "不存在"}`,
    `- **Rules 文件**：${snapshot.ruleFiles.length} 个（估算 ${snapshot.overhead.rules} tokens）`,
    `- **Skills**：${snapshot.skills.length} 个（估算 ${snapshot.overhead.skills} tokens）`,
    `- **MCP**：${snapshot.mcpServers.filter((s) => s.enabled).length}/${snapshot.mcpServers.length} 已启用（估算 ${snapshot.overhead.mcp} tokens）`,
    "",
  ];

  if (snapshot.claudeMd.exists && snapshot.claudeMd.excerpt) {
    lines.push("### CLAUDE.md 摘要", "", "```markdown", snapshot.claudeMd.excerpt, "```", "");
  }

  if (snapshot.memoryFile.exists && snapshot.memoryFile.excerpt) {
    lines.push("### Memory 摘要", "", "```markdown", snapshot.memoryFile.excerpt, "```", "");
  }

  if (snapshot.settingsFile.exists && snapshot.settingsFile.excerpt) {
    lines.push("### Settings 摘要", "", "```json", snapshot.settingsFile.excerpt, "```", "");
  }

  if (snapshot.ruleFiles.length > 0) {
    lines.push("### Rules 文件", "");
    for (const rule of snapshot.ruleFiles.slice(0, MAX_RULE_FILES_IN_PROMPT)) {
      lines.push(`- \`${rule.path}\`（${rule.charCount} 字符）`);
    }
    lines.push("");
  }

  if (snapshot.skills.length > 0) {
    lines.push("### Skills", "");
    for (const skill of snapshot.skills.slice(0, 8)) {
      lines.push(`- **${skill.name}**${skill.hasSkillMd ? "" : "（无 SKILL.md）"}`);
    }
    lines.push("");
  }

  if (snapshot.mcpServers.length > 0) {
    lines.push("### MCP Servers", "");
    for (const mcp of snapshot.mcpServers.slice(0, 10)) {
      lines.push(
        `- **${mcp.name}** · ${mcp.enabled ? "已启用" : "未启用"} · ${mcp.scope} · ${mcp.toolCount} tools`,
      );
    }
    lines.push("");
  }

  return lines;
}

const CONFIG_PATCH_JSON_SCHEMA = `{
  "patches": [
    {
      "kind": "claude_md | agents_md | rule | memory | skill | mcp | settings",
      "action": "append_section | create | update | merge_json | enable | disable",
      "path": "仓库相对路径，如 CLAUDE.md、.claude/settings.json",
      "section": "append_section 时的章节标题（可选）",
      "rationale": "为何需要此补丁（中文）",
      "content": "Markdown 或 JSON 正文；merge_json 须为合法 JSON 对象",
      "mcp": { "serverName": "...", "scope": "...", "sourcePath": "..." }
    }
  ]
}`;

/** 供主会话 AI 生成结构化配置补丁的 prompt。 */
export function buildFeedbackLoopConfigPatchPrompt(input: {
  insights: SessionInsightsResult;
  loopState: SessionFeedbackLoopState;
  snapshot?: FeedbackConfigSnapshot | null;
  meta?: SessionInsightsReportMeta;
  existingPatches?: readonly FeedbackConfigPatch[];
}): string {
  const report = buildFeedbackLoopMarkdownReport(input.loopState, input.meta);
  const lines: string[] = [
    "你是 Wise **会话反馈神经网** 的配置 Artifact 优化节点。",
    "",
    "目标：根据会话洞察与闭环指标，**直接改进 Claude Code 持久配置**（CLAUDE.md、AGENTS.md、`.claude/rules/`、memory、MCP、skills、`.claude/settings.json` hooks），使后续会话在速度/效率/质量上持续改善。",
    "",
    "## 输出格式（严格遵守）",
    "",
    "在回复末尾输出 **唯一** 一个 JSON 代码块（```json），结构如下：",
    "",
    "```json",
    CONFIG_PATCH_JSON_SCHEMA,
    "```",
    "",
    "约束：",
    "- 每条补丁必须可执行、可审阅；`rationale` 用中文",
    "- 优先 `append_section` / `create`，避免大面积 `update` 覆盖",
    "- 不要删除现有规则；增量补充为主",
    "- settings 使用 `merge_json` 增量合并 hooks/env，不要整文件覆盖",
    "- MCP 仅 `enable`/`disable`，须填 `mcp` 元数据",
    "- 单次最多 5 条补丁",
    "- 除 JSON 块外，先用 Markdown 简要说明策略",
    "",
  ];

  if (input.snapshot) {
    lines.push(...formatConfigSnapshotMarkdown(input.snapshot));
  }

  if (input.existingPatches && input.existingPatches.length > 0) {
    lines.push("## 已有候选补丁（勿重复）", "");
    for (const p of input.existingPatches) {
      lines.push(`- [${p.kind}] ${p.path} · ${p.action} · ${p.rationale.slice(0, 80)}`);
    }
    lines.push("");
  }

  lines.push("---", "", report);
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArtifactKind(raw: unknown): FeedbackConfigArtifactKind | null {
  const kinds: FeedbackConfigArtifactKind[] = [
    "claude_md",
    "agents_md",
    "rule",
    "memory",
    "mcp",
    "skill",
    "settings",
  ];
  return typeof raw === "string" && kinds.includes(raw as FeedbackConfigArtifactKind)
    ? (raw as FeedbackConfigArtifactKind)
    : null;
}

function parsePatchAction(raw: unknown): FeedbackConfigPatchAction | null {
  const actions: FeedbackConfigPatchAction[] = [
    "append_section",
    "create",
    "update",
    "merge_json",
    "enable",
    "disable",
  ];
  return typeof raw === "string" && actions.includes(raw as FeedbackConfigPatchAction)
    ? (raw as FeedbackConfigPatchAction)
    : null;
}

function parseMcpMeta(raw: unknown): FeedbackConfigPatchMcpMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const serverName = typeof raw.serverName === "string" ? raw.serverName.trim() : "";
  const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
  const sourcePath = typeof raw.sourcePath === "string" ? raw.sourcePath.trim() : "";
  if (!serverName || !scope || !sourcePath) return undefined;
  return {
    serverName,
    scope,
    sourcePath,
    claudeJsonProjectKey:
      typeof raw.claudeJsonProjectKey === "string" ? raw.claudeJsonProjectKey : null,
  };
}

export function normalizeFeedbackConfigPatch(raw: unknown, index: number): FeedbackConfigPatch | null {
  if (!isRecord(raw)) return null;
  const kind = parseArtifactKind(raw.kind);
  const action = parsePatchAction(raw.action);
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  if (!kind || !action || !path || !rationale) return null;
  if (action === "merge_json") {
    try {
      JSON.parse(content);
    } catch {
      return null;
    }
  } else if (action !== "enable" && action !== "disable" && !content.trim()) {
    return null;
  }

  const base: FeedbackConfigPatch = {
    id: createFeedbackConfigPatchId(`ai-${index}`),
    kind,
    action,
    path,
    section: typeof raw.section === "string" ? raw.section.trim() || undefined : undefined,
    rationale,
    content,
    source: "ai",
    status: "pending",
    mcp: parseMcpMeta(raw.mcp),
  };
  return resolveFeedbackConfigPatchPath(base);
}

/** 从 AI 回复中提取并校验配置补丁 JSON。 */
export function parseConfigPatchesFromAiResponse(text: string): FeedbackConfigPatch[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const block = matches[i]?.[1]?.trim();
    if (!block) continue;
    try {
      const parsed = JSON.parse(block) as unknown;
      const list = isRecord(parsed) && Array.isArray(parsed.patches) ? parsed.patches : null;
      if (!list) continue;
      const patches = list
        .map((item, idx) => normalizeFeedbackConfigPatch(item, idx))
        .filter((p): p is FeedbackConfigPatch => p != null);
      if (patches.length > 0) return dedupeFeedbackConfigPatches(patches);
    } catch {
      /* try previous block */
    }
  }
  return [];
}

export function mergeAppendSectionContent(
  existing: string,
  section: string | undefined,
  body: string,
): string {
  const trimmedBody = body.trim();
  if (!trimmedBody) return existing;
  const header = section?.trim() ? `\n\n## ${section.trim()}\n\n` : "\n\n";
  const base = existing.trimEnd();
  if (!base) return section?.trim() ? `## ${section.trim()}\n\n${trimmedBody}` : trimmedBody;
  return `${base}${header}${trimmedBody}`;
}

/** 计算应用补丁后的预览文本（不落盘）。 */
export function previewPatchContent(
  patch: FeedbackConfigPatch,
  currentContent: string | null,
): string {
  const existing = currentContent ?? "";
  switch (patch.action) {
    case "append_section":
      return mergeAppendSectionContent(existing, patch.section, patch.content);
    case "merge_json":
      return mergeJsonPatchContent(existing || null, patch.content);
    case "create":
    case "update":
      return patch.content;
    case "enable":
    case "disable":
      return existing;
    default:
      return existing;
  }
}

export function formatConfigPatchMarkdown(patch: FeedbackConfigPatch): string {
  const lines = [
    `### [${feedbackConfigArtifactKindLabel(patch.kind)}] ${patch.path}`,
    "",
    `- **动作**：${patch.action}${patch.section ? ` · 章节「${patch.section}」` : ""}`,
    `- **来源**：${patch.source === "ai" ? "AI" : "规则引擎"}`,
    `- **状态**：${patch.status}`,
    `- **理由**：${patch.rationale}`,
    "",
  ];
  if (patch.action === "enable" || patch.action === "disable") {
    lines.push(`- **MCP**：${patch.mcp?.serverName ?? "—"} → ${patch.action}`, "");
  } else if (patch.action === "merge_json" && patch.content.trim()) {
    lines.push("```json", patch.content.trim(), "```", "");
  } else if (patch.content.trim()) {
    lines.push("```markdown", patch.content.trim(), "```", "");
  }
  return lines.join("\n");
}

export function buildConfigPatchReviewMarkdown(patches: readonly FeedbackConfigPatch[]): string {
  const pending = patches.filter((p) => p.status === "pending");
  if (pending.length === 0) return "暂无待审阅的配置补丁。";
  return ["# 反馈神经网 · 配置 Artifact 补丁", "", ...pending.flatMap(formatConfigPatchMarkdown)].join(
    "\n",
  );
}

/** 将配置 Artifact 优化指引并入反馈神经网优化 prompt。 */
export function buildConfigArtifactOptimizationSection(
  snapshot?: FeedbackConfigSnapshot | null,
): string[] {
  const lines = [
    "## 配置 Artifact 优化（持久改进）",
    "",
    "除会话内策略外，请同时给出可写入 **CLAUDE.md / rules / memory / MCP / skills** 的建议（Markdown 列表）。",
    "每条须注明：目标文件、增量内容、预期对速度/效率/质量的收益。",
    "",
  ];
  if (snapshot) {
    lines.push(...formatConfigSnapshotMarkdown(snapshot));
  }
  return lines;
}
