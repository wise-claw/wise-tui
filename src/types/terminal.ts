export type TerminalSessionSource = "user" | "agent";

export type TerminalSessionStatus = "running" | "exited";

export type TerminalSessionInfo = {
  workspaceId: string;
  terminalId: string;
  title: string;
  source: TerminalSessionSource;
  status: TerminalSessionStatus;
  cwd: string;
  cols: number;
  rows: number;
  cursor: number;
};

export type TerminalAttachResponse = {
  cursor: number;
  replay: string;
};

/** 面板收起或切换 tab 时缓存的终端画面状态，用于重挂载后恢复。 */
export type TerminalSurfaceSnapshot = {
  cols?: number;
  rows?: number;
  scrollY?: number;
  cursor: number;
};
