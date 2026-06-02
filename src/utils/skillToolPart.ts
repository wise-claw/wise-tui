import type { ToolUsePart } from "../types";

/** Claude Code Skill 工具（tool_use name 为 Skill / skill，或 input 含 skill 字段）。 */
export function isSkillToolPart(part: ToolUsePart): boolean {
  const n = part.name.trim().toLowerCase();
  if (n === "skill" || n.includes("skill")) return true;
  const input = part.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const sk = (input as Record<string, unknown>).skill;
    return typeof sk === "string" && sk.trim().length > 0;
  }
  return false;
}

export function skillToolDisplayName(part: ToolUsePart): string {
  const input = part.input as Record<string, unknown>;
  const skillName =
    (typeof input.skill === "string" && input.skill.trim()) ||
    (typeof input.skill_name === "string" && input.skill_name.trim()) ||
    "";
  return skillName || part.name.trim() || "Skill";
}
