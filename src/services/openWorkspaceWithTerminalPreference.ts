import type { OpenAppTarget } from "../types";
import { detectedMacTerminalToOpenTarget } from "./macosTerminal";
import { OPEN_WORKSPACE_ERROR, openWorkspaceWithOpenAppTarget } from "./openWorkspaceWithPreference";
import { resolveStoredTerminalOpenTarget } from "./terminalAppPreference";

/** 使用已保存的默认 macOS 终端打开目录（需先完成检测与偏好设置）。 */
export async function openWorkspaceWithDefaultTerminal(workspacePath: string): Promise<void> {
  const path = workspacePath.trim();
  if (!path) {
    throw new Error(OPEN_WORKSPACE_ERROR.EMPTY_PATH);
  }
  const terminal = resolveStoredTerminalOpenTarget();
  if (!terminal) {
    throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  }
  const target: OpenAppTarget = detectedMacTerminalToOpenTarget(terminal);
  await openWorkspaceWithOpenAppTarget(path, target);
}
