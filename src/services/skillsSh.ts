import { invoke } from "@tauri-apps/api/core";

export interface SkillsShSkillEntry {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

export interface SkillsShSearchResponse {
  query: string;
  searchType: string;
  skills: SkillsShSkillEntry[];
  count: number;
}

export async function skillsShSearch(query: string, limit = 20): Promise<SkillsShSearchResponse> {
  try {
    return await invoke<SkillsShSearchResponse>("skills_sh_search", { q: query, limit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}

export type SkillsInstallScope = "project" | "global";

/** 使用官方 `skills` CLI 从 skills.sh 安装（`project` → 仓库 `.claude/skills/`，`global` → `~/.claude/skills/`；需本机 Node / npx）。 */
export async function skillsCliAddFromRegistry(
  projectPath: string | null,
  source: string,
  skillId: string,
  scope: SkillsInstallScope,
): Promise<string> {
  try {
    return await invoke<string>("skills_cli_add_from_registry", {
      projectPath: projectPath ?? "",
      source,
      skillId,
      scope,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}

export async function skillsCliRemoveFromRegistry(
  projectPath: string | null,
  skillId: string,
  scope: SkillsInstallScope,
): Promise<string> {
  try {
    return await invoke<string>("skills_cli_remove_from_registry", {
      projectPath: projectPath ?? "",
      skillId,
      scope,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}
