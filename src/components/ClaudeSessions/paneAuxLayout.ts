import type { ReactNode } from "react";

export interface PaneAuxLayout {
  /** 中栏「消息」下方面板节点：editor（文件 tab）/ memo（备忘录）。 */
  panelBelowMessages?: ReactNode;
  /** 中栏「终端」面板节点：内置终端。DOM 中与 panelBelowMessages 并存，由 centerView 互斥显隐。 */
  panelBelowTerminal?: ReactNode;
  hideMessages: boolean;
  hideSessionTools: boolean;
}

export type ResolvePaneAuxLayout = (paneIndex: number) => PaneAuxLayout;
