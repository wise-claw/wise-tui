import type { OpenAppTarget } from "../types";
import { DEFAULT_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import { joinRepositoryAbsolutePath } from "../utils/repositoryPreviewBinary";
import { resolveOpenAppTargetById } from "../utils/openAppScope";
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
  return resolveOpenAppTargetById(null, resolveTargetList(openTargets));
}

/** 解析作用域覆盖或全局默认的「打开方式」目标。 */
export function resolveScopedOpenAppTarget(
  scopeOpenAppId?: string | null,
  openTargets?: readonly OpenAppTarget[],
): OpenAppTarget | null {
  return resolveOpenAppTargetById(scopeOpenAppId, resolveTargetList(openTargets));
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
  scopeOpenAppId?: string | null,
): Promise<void> {
  const t = resolveScopedOpenAppTarget(scopeOpenAppId, openTargets);
  if (!t) {
    throw new Error(OPEN_WORKSPACE_ERROR.NO_TARGET);
  }
  await openWorkspaceWithOpenAppTarget(workspacePath, t);
}

/** 使用当前「打开方式」偏好打开仓库：工作区为仓库根，IDE 内定位到相对路径文件（与顶栏 OpenAppMenu 偏好一致） */
export async function openRepositoryFileWithStoredPreference(
  repositoryPath: string,
  relativePath: string,
  openTargets?: readonly OpenAppTarget[],
  options?: { line?: number | null; column?: number | null },
): Promise<void> {
  const root = repositoryPath.trim();
  const rel = relativePath.trim();
  if (!root || !rel) {
    throw new Error(OPEN_WORKSPACE_ERROR.EMPTY_PATH);
  }
  const target = resolveStoredOpenAppTarget(openTargets);
  if (!target) {
    throw new Error(OPEN_WORKSPACE_ERROR.NO_TARGET);
  }
  const abs = joinRepositoryAbsolutePath(root, rel);

  if (target.kind === "finder") {
    await openInFinder(abs);
    return;
  }

  const gotoLine =
    options?.line != null && Number.isFinite(options.line) && options.line > 0
      ? Math.floor(options.line)
      : 1;
  const gotoColumn =
    options?.column != null && Number.isFinite(options.column) && options.column > 0
      ? Math.floor(options.column)
      : 1;

  const ideOpen = {
    ideGotoRelative: rel,
    gotoLine,
    gotoColumn,
  } as const;

  if (target.kind === "command") {
    const cmd = resolveCommand(target);
    if (!cmd) {
      throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
    }
    await openWorkspaceIn(root, {
      command: cmd,
      args: target.args ?? [],
      ...ideOpen,
    });
    return;
  }

  const appName = resolveAppName(target);
  if (!appName) {
    throw new Error(OPEN_WORKSPACE_ERROR.NOT_CONFIGURED);
  }
  await openWorkspaceIn(root, {
    appName,
    args: target.args ?? [],
    ...ideOpen,
  });
}
