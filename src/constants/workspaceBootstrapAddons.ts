import type { SddMode } from "../types";

/** 新建工作区 / 添加单仓 / SDD 模式保存时安装的 OMC 插件引用。 */
export const WORKSPACE_BOOTSTRAP_OMC_INSTALL_REF = "oh-my-claudecode@omc";

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
  if (enabled) {
    return {
      ...prev,
      trellis: true,
      trellisInit: false,
      omc: false,
    };
  }
  return { ...prev, trellis: false };
}

export function setWorkspaceBootstrapAddonEnabled(
  prev: WorkspaceBootstrapSelection,
  key: "trellisInit" | "omc",
  enabled: boolean,
): WorkspaceBootstrapSelection {
  if (prev.trellis) {
    return prev;
  }
  return { ...prev, [key]: enabled };
}

/** 根据内置能力开关推断写入仓库/工作区的 SDD 模式。 */
export function workspaceBootstrapSelectionToSddMode(
  selection: WorkspaceBootstrapSelection,
): SddMode {
  return selection.trellis ? "wise_trellis" : "project_owned";
}

export function workspaceBootstrapNeedsTrellisInit(selection: WorkspaceBootstrapSelection): boolean {
  return selection.trellis || selection.trellisInit;
}

export interface WorkspaceBootstrapSelection {
  /** 内置 Wise Trellis：trellis init + SDD wise_trellis */
  trellis: boolean;
  /** 仅 Trellis CLI 初始化 .trellis（不与 Wise Trellis 同时开启） */
  trellisInit: boolean;
  omc: boolean;
  superpowers: boolean;
  gsd: boolean;
  openspec: boolean;
}

export const DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION: WorkspaceBootstrapSelection = {
  trellis: true,
  trellisInit: false,
  omc: false,
  superpowers: false,
  gsd: false,
  openspec: false,
};

export function workspaceBootstrapHasAnyAddon(selection: WorkspaceBootstrapSelection): boolean {
  return selection.trellis || selection.trellisInit || selection.omc;
}
