import { invoke } from "@tauri-apps/api/core";
import { trackAsyncOperation } from "../stores/operationWatchdogStore";
import type { AgentsDirectoryScan, AgentsFileContent } from "../types/agentsExplorer";
import { AGENTS_EXPLORER_SCAN_TIMEOUT_MS } from "../utils/ipcTimeouts";

/** 扫描仓库根目录的 `.agents`，返回命令 / 技能 / 智能体 / 其他资产清单。 */
export async function scanAgentsDirectory(repositoryPath: string): Promise<AgentsDirectoryScan> {
  return trackAsyncOperation(
    "探索 .agents 目录",
    invoke<AgentsDirectoryScan>("agents_explorer_scan", { repositoryPath }),
    AGENTS_EXPLORER_SCAN_TIMEOUT_MS,
  );
}

/** 读取 `.agents` 内的文件内容用于预览（后端限制路径并截断长文件）。 */
export async function readAgentsFile(path: string): Promise<AgentsFileContent> {
  return invoke<AgentsFileContent>("agents_explorer_read_file", { arg: { path } });
}
