import { openExternalUrl } from "./openExternal";

export const CLAUDE_LSP_PLUGINS_DOC_URL = "https://code.claude.com/docs/zh-CN/plugins";

export function openClaudeLspPluginsDoc(): void {
  void openExternalUrl(CLAUDE_LSP_PLUGINS_DOC_URL);
}
