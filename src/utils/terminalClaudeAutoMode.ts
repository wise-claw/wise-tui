/** 在 Wise 内嵌终端中启动 Claude Code 自动权限模式的命令。 */
export const CLAUDE_AUTO_MODE_TERMINAL_COMMAND = "claude --permission-mode auto";

export function buildClaudeAutoModeTerminalInput(): string {
  return `${CLAUDE_AUTO_MODE_TERMINAL_COMMAND}\n`;
}
