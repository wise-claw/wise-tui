import type { OpenAppTarget } from "../types";
import { ensureMacTerminalsDetected, detectedMacTerminalToOpenTarget } from "./macosTerminal";
import { OPEN_WORKSPACE_ERROR, openWorkspaceWithOpenAppTarget } from "./openWorkspaceWithPreference";
import { hydrateTerminalAppPreference, resolveStoredTerminalOpenTarget } from "./terminalAppPreference";

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

export function resolveOpenDefaultTerminalUserMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
    return "请先在「工作台配置 → 默认配置」中选择默认终端";
  }
  if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
    return "目录路径为空";
  }
  if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
    return "未找到可用的终端";
  }
  return err instanceof Error ? err.message : String(err);
}

/** 检测终端并尝试用默认终端打开目录；供侧栏菜单等 UI 调用。 */
export async function tryOpenWorkspaceInDefaultTerminal(
  workspacePath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await ensureMacTerminalsDetected();
  await hydrateTerminalAppPreference();
  try {
    await openWorkspaceWithDefaultTerminal(workspacePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: resolveOpenDefaultTerminalUserMessage(err) };
  }
}
