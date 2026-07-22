export type TerminalSessionSource = "user" | "agent" | "background-script";

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
  /**
   * 后台任务子进程 pid，仅 source="background-script" 时有值；
   * 交互终端（user/agent）始终为 0。前端用来在运行面板展示进程号。
   */
  pid?: number;
};

export type TerminalCellRun = {
  text: string;
  fg: string;
  bg: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  strike?: boolean;
};

export type TerminalFrame = {
  cols: number;
  rows: number;
  cursor: {
    col: number;
    row: number;
    visible: boolean;
  };
  lines: TerminalCellRun[][];
};

export type TerminalAttachResponse = {
  cursor: number;
  /** 原始文本重放（运行面板等文本消费者）。 */
  replay: string;
  /** alacritty_terminal 可视网格，供内置终端 Canvas 渲染。 */
  frame: TerminalFrame;
};

/** 面板收起或切换 tab 时缓存的终端画面状态，用于重挂载后恢复。 */
export type TerminalSurfaceSnapshot = {
  cols?: number;
  rows?: number;
  scrollY?: number;
  cursor: number;
};
