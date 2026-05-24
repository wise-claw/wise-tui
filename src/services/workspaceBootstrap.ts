import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  WORKSPACE_BOOTSTRAP_OMC_INSTALL_REF,
  workspaceBootstrapNeedsTrellisInit,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import { claudePluginInstall, claudePluginMarketBootstrap } from "./claudePluginMarket";
import { bootstrapTrellisIfMissing } from "./trellisBootstrap";

export type { WorkspaceBootstrapSelection };
export { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 在创建 Workspace / 单仓或保存 SDD 模式前按选择执行内置初始化。 */
export async function runWorkspaceBootstrap(
  rootPath: string,
  selection: WorkspaceBootstrapSelection = DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
): Promise<void> {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    throw new Error("请先选择工作区根目录");
  }

  if (workspaceBootstrapNeedsTrellisInit(selection)) {
    try {
      await bootstrapTrellisIfMissing(trimmed);
    } catch (err: unknown) {
      throw new Error(`Trellis 初始化失败：${errorMessage(err)}`);
    }
  }

  if (selection.omc) {
    try {
      await claudePluginMarketBootstrap();
      await claudePluginInstall(WORKSPACE_BOOTSTRAP_OMC_INSTALL_REF, "user");
    } catch (err: unknown) {
      throw new Error(`oh-my-claudecode 安装失败：${errorMessage(err)}`);
    }
  }
}
