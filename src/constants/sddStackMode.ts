import type { ProjectSddMode, SddMode } from "../types";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  workspaceBootstrapSelectionToSddMode,
  type WorkspaceBootstrapSelection,
} from "./workspaceBootstrapAddons";
import { resolveAutoSddMode, type SddSignals } from "../services/sddModeDetector";

/** 仓库 SDD / 内置能力栈：用于「配置 Claude 插件」与创建时引导。 */
export type SddStackMode =
  | "auto"
  | "wise_trellis"
  | "trellis"
  | "omc"
  | "project_owned"
  | "off";

export const SDD_STACK_MODE_OPTIONS: readonly {
  label: string;
  value: SddStackMode;
  description: string;
}[] = [
  {
    label: "自动",
    value: "auto",
    description: "按仓库内的 .trellis / .openspec / .spec 信号自动选择",
  },
  {
    label: "内置 Wise Trellis",
    value: "wise_trellis",
    description: "初始化 .trellis，并启用 PRD 拆分、任务编排、规范反哺与 Workspace 主会话",
  },
  {
    label: "Trellis",
    value: "trellis",
    description: "在仓库根目录执行 trellis init，写入 .trellis/，不启用 Wise 全套 SDD 入口",
  },
  {
    label: "oh-my-claudecode",
    value: "omc",
    description: "安装 OMC 插件（多智能体编排与自然语言工作流），Wise 保留 Claude Code 会话能力",
  },
];

export function sddStackModeToSddMode(mode: SddStackMode): SddMode {
  switch (mode) {
    case "wise_trellis":
      return "wise_trellis";
    case "off":
      return "off";
    case "auto":
      return "auto";
    case "trellis":
    case "omc":
    case "project_owned":
      return "project_owned";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function sddStackModeToBootstrap(mode: SddStackMode): WorkspaceBootstrapSelection {
  const base = { ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, trellis: false, trellisInit: false, omc: false };
  switch (mode) {
    case "wise_trellis":
      return { ...base, trellis: true };
    case "trellis":
      return { ...base, trellisInit: true };
    case "omc":
      return { ...base, omc: true };
    default:
      return base;
  }
}

/** 从已持久化的仓库 `sddMode` 推断栈模式（无法区分 trellis / omc 时回落为自有 SDD）。 */
export function sddStackModeLabel(mode: SddStackMode): string {
  return SDD_STACK_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/** 将 `resolveAutoSddMode` 结果展示为栈模式中文标签。 */
export function sddStackModeLabelForResolvedSddMode(sddMode: SddMode): string {
  if (sddMode === "wise_trellis") return sddStackModeLabel("wise_trellis");
  if (sddMode === "off") return sddStackModeLabel("off");
  if (sddMode === "project_owned") return sddStackModeLabel("project_owned");
  return sddStackModeLabel("wise_trellis");
}

export function sddStackModeFromRepositorySddMode(sddMode: SddMode | undefined): SddStackMode {
  switch (sddMode) {
    case "wise_trellis":
      return "wise_trellis";
    case "off":
      return "off";
    case "auto":
      return "auto";
    case "project_owned":
      return "project_owned";
    default:
      return "auto";
  }
}

export function sddStackModeFromProjectSddMode(sddMode: ProjectSddMode | undefined): SddStackMode {
  if (sddMode === "wise_trellis") return "wise_trellis";
  if (sddMode === "project_owned") return "project_owned";
  return "wise_trellis";
}

/** 将栈模式保存为工作区级 `ProjectSddMode`（无 `auto` / `off` 持久化字段）。 */
export function resolveProjectSddModeForStack(
  mode: SddStackMode,
  signals: SddSignals,
): ProjectSddMode {
  if (mode === "auto") {
    const resolved = resolveAutoSddMode(signals);
    return resolved === "wise_trellis" ? "wise_trellis" : "project_owned";
  }
  return workspaceBootstrapSelectionToSddMode(sddStackModeToBootstrap(mode)) as ProjectSddMode;
}
