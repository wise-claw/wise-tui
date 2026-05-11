import type { OpenAppTarget } from "../types";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "./openAppPreference";
import { openInFinder, openWorkspaceIn } from "./repository";

export const OPEN_WORKSPACE_ERROR = {
  EMPTY_PATH: "WISE_OPEN_EMPTY_PATH",
  NO_TARGET: "WISE_OPEN_NO_TARGET",
  NOT_CONFIGURED: "WISE_OPEN_NOT_CONFIGURED",
} as const;

function resolveAppName(t: OpenAppTarget): string {
  return (t.appName ?? "").trim();
}

function resolveCommand(t: OpenAppTarget): string {
  return (t.command ?? "").trim();
}

/** 与 `OpenAppMenu` 一致：能否用该目标打开路径 */
export function canOpenAppTarget(t: OpenAppTarget): boolean {
  if (t.kind === "finder") return true;
  if (t.kind === "command") return Boolean(resolveCommand(t));
  return Boolean(resolveAppName(t));
}

function resolveTargetList(openTargets?: readonly OpenAppTarget[]): readonly OpenAppTarget[] {
  return openTargets?.length ? openTargets : DEFAULT_OPEN_APP_TARGETS;
}

/** 当前持久化的「打开方式」对应目标（与中栏 `OpenAppMenu` 一致） */
export function resolveStoredOpenAppTarget(
  openTargets?: readonly OpenAppTarget[],
): OpenAppTarget | null {
  const list = resolveTargetList(openTargets);
  const id = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  return list.find((item) => item.id === id) ?? list[0] ?? null;
}

/** 使用指定目标打开工作区目录（与中栏主按钮 / 下拉选择后的行为一致） */
export async function openWorkspaceWithOpenAppTarget(
  workspacePath: string,
  t: OpenAppTarget,
): Promise<void> {
  const path = workspacePath.trim();
  if (!path) {
    throw new Error(OPEN_WORKSPACE_ERROR.EMPTY_PATH);
  }
  if (!canOpenAppTarget(t)) {
    throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  }
  if (t.kind === "finder") {
    await openInFinder(path);
    return;
  }
  if (t.kind === "command") {
    const cmd = resolveCommand(t);
    if (!cmd) {
      throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
    }
    await openWorkspaceIn(path, { command: cmd, args: t.args ?? [] });
    return;
  }
  const appName = resolveAppName(t);
  if (!appName) {
    throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  }
  await openWorkspaceIn(path, { appName, args: t.args ?? [] });
}

/** 使用当前「打开方式」偏好打开工作区目录 */
export async function openWorkspaceWithStoredPreference(
  workspacePath: string,
  openTargets?: readonly OpenAppTarget[],
): Promise<void> {
  const t = resolveStoredOpenAppTarget(openTargets);
  if (!t) {
    throw new Error(OPEN_WORKSPACE_ERROR.NO_TARGET);
  }
  await openWorkspaceWithOpenAppTarget(workspacePath, t);
}
