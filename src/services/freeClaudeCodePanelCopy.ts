import type { FreeClaudeCodeStatus } from "./freeClaudeCode";

/** 顶栏 FCC 面板主提示文案。 */
export function buildFccSummaryMessage(st: FreeClaudeCodeStatus): string {
  if (st.serverRunning) {
    if (!st.managedByWise) {
      return "代理服务运行中（非 Wise 启动）。点击「停止」将尝试结束本机 fcc-server 进程。";
    }
    if (!st.claudeSettingsAligned) {
      return "代理已运行，但 Claude Code 尚未指向 FCC。请按引导同步 settings.json。";
    }
    return "代理服务运行中，Claude 配置已对齐；可在 Admin UI 配置 Provider Key。";
  }
  if (st.installed) {
    return "已安装 fcc-server，点击「启动」运行代理服务。";
  }
  if (st.uvReady) {
    return "uv 已就绪，点击「一键安装」安装 fcc-server。";
  }
  return "请先安装 uv（https://astral.sh/uv），再使用「一键安装」。";
}

export type FccDependencyRowId =
  | "uv"
  | "fcc-server"
  | "claude-cli"
  | "proxy"
  | "claude-settings";

export interface FccDependencyRow {
  id: FccDependencyRowId;
  label: string;
  help: string;
  ready: boolean;
}

/** 依赖检查列表（与 FCC 原版面板一致）。 */
export function buildFccDependencyRows(st: FreeClaudeCodeStatus): FccDependencyRow[] {
  return [
    {
      id: "uv",
      label: "uv",
      help: "Astral uv：用于通过 `uv tool install` 安装 fcc-server。",
      ready: st.uvReady,
    },
    {
      id: "fcc-server",
      label: "fcc-server",
      help: "本机 Anthropic 兼容代理可执行文件（free-claude-code）。",
      ready: st.installed,
    },
    {
      id: "claude-cli",
      label: "Claude CLI",
      help: "Claude Code 命令行（`claude`），用于连接本机代理。",
      ready: st.claudeCliReady,
    },
    {
      id: "proxy",
      label: "代理服务",
      help: "fcc-server 监听端口并已接受连接。",
      ready: st.serverRunning,
    },
    {
      id: "claude-settings",
      label: "Claude 配置",
      help: "Claude Code settings.json 中的 ANTHROPIC_BASE_URL 已指向本机 FCC 代理。",
      ready: st.serverRunning && st.claudeSettingsAligned,
    },
  ];
}
