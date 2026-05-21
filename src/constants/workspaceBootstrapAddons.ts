import type { SddMode } from "../types";

/** 新建工作区 / 添加单仓时可选的一键内置能力（Trellis / OpenSpec 脚手架 + Claude 插件）。 */

export type WorkspaceBootstrapAddonId = "trellis" | "omc" | "superpowers" | "gsd" | "openspec";

export const WORKSPACE_SCAFFOLD_BOOTSTRAP_OPTIONS = [
  {
    id: "trellis" as const,
    label: "Trellis",
    title: "仓库目录 trellis init -y；已有 .trellis/scripts/task.py 则跳过",
  },
  {
    id: "openspec" as const,
    label: "OpenSpec",
    title: "仓库目录 openspec init --tools claude；已有 .openspec/ 则跳过",
  },
] as const;

export function patchWorkspaceBootstrapSelection(
  prev: WorkspaceBootstrapSelection,
  patch: Partial<WorkspaceBootstrapSelection>,
): WorkspaceBootstrapSelection {
  return { ...prev, ...patch };
}

/** 根据一键内置选项推断写入仓库的 SDD 模式。 */
export function workspaceBootstrapSelectionToSddMode(
  selection: WorkspaceBootstrapSelection,
): SddMode {
  if (!selection.trellis && !selection.openspec) return "auto";
  if (selection.openspec && !selection.trellis) return "project_owned";
  return "wise_trellis";
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

export interface WorkspaceBootstrapPluginAddon {
  id: Exclude<WorkspaceBootstrapAddonId, "trellis" | "openspec">;
  label: string;
  shortLabel: string;
  installRef: string;
}

/** 通过 `claude plugin install` 安装的用户级插件（与插件市场目录一致）。 */
export const WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS: readonly WorkspaceBootstrapPluginAddon[] = [
  {
    id: "omc",
    label: "Oh My ClaudeCode",
    shortLabel: "OMC",
    installRef: "oh-my-claudecode@omc",
  },
  {
    id: "superpowers",
    label: "Superpowers",
    shortLabel: "Superpowers",
    installRef: "superpowers@superpowers-marketplace",
  },
  {
    id: "gsd",
    label: "GSD2",
    shortLabel: "GSD2",
    installRef: "gsd@gsd-plugin",
  },
] as const;

export function workspaceBootstrapPluginInstallRefs(
  selection: WorkspaceBootstrapSelection,
): string[] {
  return WORKSPACE_BOOTSTRAP_PLUGIN_ADDONS.filter((addon) => selection[addon.id]).map(
    (addon) => addon.installRef,
  );
}

export function workspaceBootstrapHasAnyAddon(selection: WorkspaceBootstrapSelection): boolean {
  return (
    selection.trellis ||
    selection.openspec ||
    workspaceBootstrapPluginInstallRefs(selection).length > 0
  );
}
