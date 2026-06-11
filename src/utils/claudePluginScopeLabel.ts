import type { ClaudePluginInstallScope } from "../services/claudePluginMarket";

export function normalizeClaudePluginScope(scope: string): ClaudePluginInstallScope {
  switch (scope.trim().toLowerCase()) {
    case "project":
      return "project";
    case "local":
      return "local";
    default:
      return "user";
  }
}

export function claudePluginScopeLabel(scope: string): string {
  switch (normalizeClaudePluginScope(scope)) {
    case "project":
      return "项目";
    case "local":
      return "本地";
    default:
      return "全局";
  }
}

export function claudePluginInstalledKey(id: string, scope: string): string {
  return `${id}::${normalizeClaudePluginScope(scope)}`;
}
