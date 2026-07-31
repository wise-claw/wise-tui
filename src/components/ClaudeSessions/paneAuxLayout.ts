import type { ReactNode } from "react";

export interface PaneAuxLayout {
  /** 中栏「文件」面板节点：仓库文件编辑器。 */
  panelBelowMessages?: ReactNode;
  /** 中栏「需求」面板节点；与文件/快捷操作/终端独立并存。 */
  panelBelowRequirements?: ReactNode;
  /** 中栏「快捷操作」面板节点；与文件/需求/终端独立并存。 */
  panelBelowQuickActions?: ReactNode;
  /** 中栏「终端」面板节点：内置终端。DOM 中与其它 slot 并存，由 centerView 互斥显隐。 */
  panelBelowTerminal?: ReactNode;
  hideMessages: boolean;
  hideSessionTools: boolean;
}

export type ResolvePaneAuxLayout = (paneIndex: number) => PaneAuxLayout;
