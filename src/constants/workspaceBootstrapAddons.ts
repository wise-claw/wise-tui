import type { SddMode } from "../types";

/** 新建工作区 / 添加单仓时是否启用 Wise 内置 Trellis 工作流。 */

export function patchWorkspaceBootstrapSelection(
  prev: WorkspaceBootstrapSelection,
  patch: Partial<WorkspaceBootstrapSelection>,
): WorkspaceBootstrapSelection {
  return { ...prev, ...patch };
}

export function setWiseTrellisBootstrapEnabled(
  prev: WorkspaceBootstrapSelection,
  enabled: boolean,
): WorkspaceBootstrapSelection {
  return {
    ...prev,
    trellis: enabled,
    openspec: false,
    omc: false,
    superpowers: false,
    gsd: false,
  };
}

/** 根据 Wise Trellis 开关推断写入仓库/工作区的 SDD 模式。 */
export function workspaceBootstrapSelectionToSddMode(
  selection: WorkspaceBootstrapSelection,
): SddMode {
  return selection.trellis ? "wise_trellis" : "project_owned";
}

export interface WorkspaceBootstrapSelection {
  trellis: boolean;
  omc: boolean;
  superpowers: boolean;
  gsd: boolean;
  openspec: boolean;
}

export const DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION: WorkspaceBootstrapSelection = {
  trellis: true,
  omc: false,
  superpowers: false,
  gsd: false,
  openspec: false,
};

export function workspaceBootstrapHasAnyAddon(selection: WorkspaceBootstrapSelection): boolean {
  return selection.trellis;
}
