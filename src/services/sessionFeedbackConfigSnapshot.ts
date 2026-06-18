import { getClaudeMcpStatus, listClaudeProjectSkills } from "./claude";
import {
  loadContextOverheadEstimate,
  type ContextOverheadEstimate,
} from "./claudeContextBreakdown";
import { listProjectRelativeDirectory, readProjectRelativeFile } from "./projectRelativeFiles";
import type {
  FeedbackConfigSnapshot,
  FeedbackConfigSnapshotFile,
  FeedbackConfigSnapshotMcp,
  FeedbackConfigSnapshotSkill,
} from "../utils/sessionFeedbackConfigPatch";

const MAX_EXCERPT = 1200;

function excerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXCERPT) return trimmed;
  return `${trimmed.slice(0, MAX_EXCERPT)}…`;
}

async function readSnapshotFile(
  repositoryPath: string,
  relativePath: string,
): Promise<FeedbackConfigSnapshotFile> {
  try {
    const content = await readProjectRelativeFile(repositoryPath, relativePath);
    return {
      path: relativePath,
      exists: true,
      charCount: content.length,
      excerpt: excerpt(content),
    };
  } catch {
    return {
      path: relativePath,
      exists: false,
      charCount: 0,
      excerpt: "",
    };
  }
}

async function listRuleFiles(repositoryPath: string): Promise<FeedbackConfigSnapshotFile[]> {
  try {
    const paths = await listProjectRelativeDirectory(repositoryPath, ".claude/rules");
    const mdPaths = paths.filter((p) => p.endsWith(".md")).slice(0, 12);
    const files = await Promise.all(
      mdPaths.map((relativePath) => readSnapshotFile(repositoryPath, relativePath)),
    );
    return files.filter((f) => f.exists);
  } catch {
    return [];
  }
}

function mapSkills(
  skills: Awaited<ReturnType<typeof listClaudeProjectSkills>>,
): FeedbackConfigSnapshotSkill[] {
  return skills.map((skill) => ({
    name: skill.name,
    hasSkillMd: skill.hasSkillMd,
    description: skill.description ?? undefined,
  }));
}

function flattenMcpServers(
  status: Awaited<ReturnType<typeof getClaudeMcpStatus>>,
): FeedbackConfigSnapshotMcp[] {
  const buckets = [
    status.user,
    status.local,
    status.projectShared,
    status.legacyUserSettings,
    status.legacyProjectSettings,
    status.pluginMcp,
  ];
  const out: FeedbackConfigSnapshotMcp[] = [];
  for (const items of buckets) {
    for (const item of items) {
      out.push({
        name: item.name,
        enabled: item.enabled,
        scope: item.scope,
        sourcePath: item.sourcePath,
        toolCount: item.tools.length,
      });
    }
  }
  return out;
}

function overheadFromEstimate(estimate: ContextOverheadEstimate) {
  return {
    rules: estimate.rules,
    skills: estimate.skills,
    mcp: estimate.mcp,
    subagents: estimate.subagents,
  };
}

/** 加载仓库 Claude Code 配置快照（供反馈神经网诊断与补丁生成）。 */
export async function loadFeedbackConfigSnapshot(
  repositoryPath: string,
): Promise<FeedbackConfigSnapshot | null> {
  const trimmed = repositoryPath.trim();
  if (!trimmed) return null;

  const [claudeMd, agentsMd, memoryFile, settingsFile, ruleFiles, skills, mcpStatus, overheadEstimate] =
    await Promise.all([
    readSnapshotFile(trimmed, "CLAUDE.md"),
    readSnapshotFile(trimmed, "AGENTS.md"),
    readSnapshotFile(trimmed, ".claude/project-memory.md"),
    readSnapshotFile(trimmed, ".claude/settings.json"),
    listRuleFiles(trimmed),
    listClaudeProjectSkills(trimmed).catch(() => []),
    getClaudeMcpStatus(trimmed).catch(() => null),
    loadContextOverheadEstimate(trimmed).catch(() => null),
  ]);

  return {
    repositoryPath: trimmed,
    capturedAt: Date.now(),
    claudeMd,
    agentsMd,
    memoryFile,
    settingsFile,
    ruleFiles,
    skills: mapSkills(skills),
    mcpServers: mcpStatus ? flattenMcpServers(mcpStatus) : [],
    overhead: overheadFromEstimate(overheadEstimate ?? { rules: 0, skills: 0, mcp: 0, subagents: 0, systemPrompt: 0, toolDefinitions: 0 }),
  };
}
