/** Claude Code 斜杠命令 / Skill 名称：字母数字开头，可含 `-_.:`（`:` 用于子目录命名空间，如 `loom:init`）。 */
export const SLASH_COMMAND_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.:]*$/;

export function isSlashCommandName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 96 && SLASH_COMMAND_NAME_RE.test(trimmed);
}
