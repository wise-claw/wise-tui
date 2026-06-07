import type { ReactNode } from "react";

export interface PaneAuxLayout {
  panelBelowMessages?: ReactNode;
  hideMessages: boolean;
  hideSessionTools: boolean;
}

export type ResolvePaneAuxLayout = (paneIndex: number) => PaneAuxLayout;
