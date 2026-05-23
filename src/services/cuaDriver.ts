import { invoke } from "@tauri-apps/api/core";
import { addClaudeMcpServer } from "./claude";
import type { ClaudeMcpItem, ClaudeMcpStatusResponse } from "../types";

export interface CuaDriverStatus {
  platformMacos: boolean;
  installed: boolean;
  resolvedPath: string | null;
  versionLine: string | null;
  hint: string;
}

const BROWSER_STATUS: CuaDriverStatus = {
  platformMacos: false,
  installed: false,
  resolvedPath: null,
  versionLine: null,
  hint: "当前为浏览器预览，无法安装或检测 cua-driver；请在 Wise 桌面端使用 MCP 面板的「安装」。",
};

export async function getCuaDriverStatus(): Promise<CuaDriverStatus> {
  try {
    return await invoke<CuaDriverStatus>("get_cua_driver_status");
  } catch {
    return BROWSER_STATUS;
  }
}

/** 执行官方 cua-driver install.sh（需网络）。 */
export async function installCuaDriver(): Promise<string> {
  return invoke<string>("install_cua_driver");
}

/** 已安装时再次执行同一 install.sh，用于升级到官方脚本当前提供的最新构建（需网络）。 */
export async function updateCuaDriver(): Promise<string> {
  return installCuaDriver();
}

/** 打开 macOS 系统设置中的隐私子页面（不经前端 opener 白名单限制）。 */
export async function macosOpenPrivacyPane(
  pane: "accessibility" | "screenCapture" | "microphone" | "speechRecognition",
): Promise<void> {
  return invoke("macos_open_privacy_pane", { pane });
}

function itemLooksLikeCuaDriverMcp(it: ClaudeMcpItem): boolean {
  if (it.name.trim() === "cua-driver") return true;
  const cmd = it.command.toLowerCase();
  return cmd.includes("cua-driver") && cmd.includes("mcp");
}

export function computerUseMcpLikelyRegistered(data: ClaudeMcpStatusResponse): boolean {
  const lists: ClaudeMcpItem[][] = [
    data.user,
    data.local,
    data.projectShared,
    data.legacyUserSettings,
    data.legacyProjectSettings,
  ];
  return lists.some((items) => items.some(itemLooksLikeCuaDriverMcp));
}

/**
 * 向 Claude Code 用户范围注册 stdio MCP：`绝对路径 mcp --claude-code-computer-use-compat`
 *（与 Cua 文档中 Claude Code 兼容模式一致，便于截图 + 坐标 / SOM 工作流）。
 */
export async function registerCuaDriverComputerUseMcp(executablePath: string): Promise<void> {
  const cmd = executablePath.trim();
  if (!cmd) throw new Error("cua-driver 路径为空");
  await addClaudeMcpServer({
    scope: "user",
    transport: "stdio",
    name: "cua-driver",
    repositoryPath: null,
    url: null,
    command: cmd,
    args: ["mcp", "--claude-code-computer-use-compat"],
    headers: null,
    envPairs: null,
  });
}
