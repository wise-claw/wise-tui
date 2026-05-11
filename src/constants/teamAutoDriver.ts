/** 与 ClaudeChat 中团队自动调度识别一致：最新用户消息以此开头则视为团队流程会话。 */
export const TEAM_AUTO_DRIVER_PREFIXES = [
  "# 团队流程自动执行",
  "# 团队流程自动流转",
  "# 工作流自动执行",
  "# 工作流自动流转",
] as const;
