import type { MenuProps } from "antd";
import {
  paneRuntimePresetToOverride,
  resolvePaneRuntimeDisplayLabel,
  type PaneRuntimeOverride,
  type PaneRuntimePreset,
} from "../../types/paneRuntimeOverride";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";

export const PANE_RUNTIME_PRESET_OPTIONS: Array<{
  label: string;
  value: PaneRuntimePreset;
  title: string;
}> = [
  { label: "Claude Code", value: "claude-direct", title: "Claude Code 直连（不经 Wise 代理）" },
  { label: "代理", value: "claude-proxy", title: "Claude Code 经 OpenCode / LLM / FCC 代理" },
  { label: "Codex", value: "codex", title: "OpenAI Codex CLI" },
];

export function isPaneRuntimePresetKey(key: string): key is PaneRuntimePreset {
  return key === "claude-direct" || key === "claude-proxy" || key === "codex";
}

export function resolvePaneRuntimePresetLabel(
  runtimeOverride: PaneRuntimeOverride | null | undefined,
  resolvedEngine: SessionExecutionEngine,
): string {
  return resolvePaneRuntimeDisplayLabel(runtimeOverride, resolvedEngine);
}

export function buildPaneRuntimePresetMenuItems(
  activePreset: PaneRuntimePreset | null,
  inferredPreset?: PaneRuntimePreset | null,
  options?: { codexAvailable?: boolean },
): MenuProps["items"] {
  // activePreset 为空（pane 无显式 override）时，回退到根据生效引擎推断的预设，
  // 确保继承默认的 pane 也能在菜单中高亮当前预设。
  const codexAvailable = options?.codexAvailable ?? true;
  const selectedPreset = activePreset ?? inferredPreset ?? null;
  return PANE_RUNTIME_PRESET_OPTIONS
    .filter((item) => {
      if (item.value === "codex") return codexAvailable;
      return true;
    })
    .map((item) => {
    const isSelected = selectedPreset !== null && selectedPreset === item.value;
    return {
      key: item.value,
      className: `app-claude-connection-kind-menu-item-wrapper ${
        isSelected ? "app-claude-connection-kind-menu-item-wrapper--selected" : ""
      }`,
      label: (
        <div
          className={`app-claude-connection-kind-menu-item${
            isSelected ? " app-claude-connection-kind-menu-item--selected" : ""
          }`}
        >
          <div className="app-claude-connection-kind-menu-item__body">
            <span className="app-claude-connection-kind-menu-item__title">{item.label}</span>
            <span className="app-claude-connection-kind-menu-item__desc">{item.title}</span>
          </div>
        </div>
      ),
    };
  });
}

export function applyPaneRuntimePreset(
  paneIndex: number,
  preset: PaneRuntimePreset,
  onUpdatePaneRuntimeOverride: (paneIndex: number, patch: Partial<PaneRuntimeOverride>) => void,
): void {
  onUpdatePaneRuntimeOverride(paneIndex, paneRuntimePresetToOverride(preset));
}
