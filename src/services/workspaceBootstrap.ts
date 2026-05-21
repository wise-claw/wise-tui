import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  workspaceBootstrapPluginInstallRefs,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import { claudePluginInstall, claudePluginMarketBootstrap } from "./claudePluginMarket";
import { bootstrapOpenspecIfMissing } from "./openspecBootstrap";
import { bootstrapTrellisIfMissing } from "./trellisBootstrap";

export type { WorkspaceBootstrapSelection };
export { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 在创建 Workspace 前于根目录 / 本机 Claude 环境执行所选一键内置。 */
export async function runWorkspaceBootstrap(
  rootPath: string,
  selection: WorkspaceBootstrapSelection = DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
): Promise<void> {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    throw new Error("请先选择工作区根目录");
  }

  const failures: string[] = [];

  if (selection.trellis) {
    try {
      await bootstrapTrellisIfMissing(trimmed);
    } catch (err: unknown) {
      failures.push(`Trellis：${errorMessage(err)}`);
    }
  }

  if (selection.openspec) {
    try {
      await bootstrapOpenspecIfMissing(trimmed);
    } catch (err: unknown) {
      failures.push(`OpenSpec：${errorMessage(err)}`);
    }
  }

  const pluginRefs = workspaceBootstrapPluginInstallRefs(selection);
  if (pluginRefs.length > 0) {
    try {
      await claudePluginMarketBootstrap();
    } catch (err: unknown) {
      failures.push(`Claude 插件市场：${errorMessage(err)}`);
    }
    for (const installRef of pluginRefs) {
      try {
        await claudePluginInstall(installRef, "user");
      } catch (err: unknown) {
        failures.push(`${installRef}：${errorMessage(err)}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}
