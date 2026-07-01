import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "./macosTerminal";
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

/**
 * 在默认终端中打开工作目录并执行用户配置的运行指令。
 *
 * - macOS：调用后端 `macos_open_terminal_with_command`，由后端按终端类型分发
 *   AppleScript / `open -a --args` 路径，新窗口先 `cd` 再跑命令。
 * - 其它平台 / 未配置默认终端：直接退化为 `tryOpenWorkspaceInDefaultTerminal`
 *   （只打开终端，不注入命令）。
 */
export async function tryOpenWorkspaceInDefaultTerminalWithCommand(
  workspacePath: string,
  command: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = command.trim();
  // 命令为空时走原有"只打开终端"路径，避免额外加 IPC 调用。
  if (!trimmed) {
    return tryOpenWorkspaceInDefaultTerminal(workspacePath);
  }
  if (!isMacPlatform()) {
    return tryOpenWorkspaceInDefaultTerminal(workspacePath);
  }

  await ensureMacTerminalsDetected();
  await hydrateTerminalAppPreference();
  const terminal = resolveStoredTerminalOpenTarget();
  if (!terminal) {
    return {
      ok: false,
      message: resolveOpenDefaultTerminalUserMessage(
        new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED),
      ),
    };
  }

  try {
    await invoke("macos_open_terminal_with_command", {
      appName: terminal.appName,
      path: workspacePath.trim(),
      command: trimmed,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
