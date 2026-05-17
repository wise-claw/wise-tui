import type { ViewMode } from "../../types/viewMode";
import { ChatInspector, type ChatInspectorProps } from "./ChatInspector";
import { CockpitInspector, type CockpitInspectorProps } from "./CockpitInspector";

export interface InspectorProps {
  /** 当前 ViewMode；Inspector 按 kind 决定渲染内容。 */
  viewMode: ViewMode;
  /** chat / inspect 模式下沿用的右栏 props（透传给 ChatInspector）。 */
  chatInspectorProps: ChatInspectorProps;
  /** cockpit 模式下的专属 props。 */
  cockpitInspectorProps: CockpitInspectorProps;
}

/**
 * 顶层 Inspector：按 ViewMode 派发右栏内容（按宪法 §4 的 Inspector 概念）。
 *
 * 路由表（与 P1 PRD §4.3 对齐）：
 *   - `chat` / `inspect`  → ChatInspector（GitPanel + ProgressMonitorPanel + ClaudeCodeToolsPanel）
 *   - `cockpit`           → CockpitInspector（Mission 概览 + 子代理活动摘要 + 活动仓库 Git）
 *   - `author`            → null（Author 域占满主屏，无需 Inspector）
 *
 * 注意：
 *   - chat 行为完全保持现状（PRD §4.3）：本组件只是把"永远显示"变成"按 mode 显示"。
 *   - cockpit Inspector 不与 MissionControl 内部 selection 耦合（详见 CockpitInspector 注释）。
 *   - inspect 与 chat 共享同一份 ChatInspector；inspect 叠层渲染在主区之上，
 *     底层右栏继续显示。
 */
export function Inspector({ viewMode, chatInspectorProps, cockpitInspectorProps }: InspectorProps) {
  if (viewMode.kind === "author") return null;
  if (viewMode.kind === "cockpit") {
    return <CockpitInspector {...cockpitInspectorProps} />;
  }
  return <ChatInspector {...chatInspectorProps} />;
}
