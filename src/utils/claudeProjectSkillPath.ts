import type { ClaudeProjectSkill } from "../types";

function joinRepositoryPath(repositoryPath: string, rel: string): string {
  const base = repositoryPath.replace(/\/+$/, "");
  const suffix = rel.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export function isClaudeProjectCommand(skill: ClaudeProjectSkill): boolean {
  return skill.entryKind === "command";
}

/** 列表展示与「打开」操作使用的绝对路径（技能目录或命令 .md 文件）。 */
export function resolveClaudeProjectSkillDisplayPath(
  skill: ClaudeProjectSkill,
  repositoryPath?: string,
): string {
  const root = skill.skillRootPath?.trim();
  if (root) return root;

  const repo = repositoryPath?.trim();
  if (!repo) return skill.name;

  if (isClaudeProjectCommand(skill) && skill.commandRelPath?.trim()) {
    return joinRepositoryPath(repo, `.claude/commands/${skill.commandRelPath.trim()}`);
  }

  return joinRepositoryPath(repo, `.claude/skills/${skill.name}`);
}
