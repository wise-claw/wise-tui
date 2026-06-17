import { getDefaultTerminalActionIcon, getKnownOpenAppIcon } from "../components/OpenAppMenu/openAppIcons";
import { isMacPlatform } from "../services/macosTerminal";
import { resolveStoredTerminalOpenTarget } from "../services/terminalAppPreference";

export function showRepositoryTerminalOpenMenuItem(): boolean {
  return isMacPlatform();
}

/** 侧栏「在终端打开」菜单文案（依赖已检测终端与默认配置）。 */
export function repositoryTerminalOpenMenuLabel(): string {
  const terminal = resolveStoredTerminalOpenTarget();
  if (terminal?.label) {
    return `在 ${terminal.label} 中打开`;
  }
  return "终端打开";
}

/** 侧栏「在终端打开」按钮图标（依赖已检测终端与默认配置）。 */
export function repositoryTerminalOpenAppIcon(): string {
  const terminal = resolveStoredTerminalOpenTarget();
  if (!terminal?.id) return getDefaultTerminalActionIcon();
  return getKnownOpenAppIcon(terminal.id) ?? getDefaultTerminalActionIcon();
}
