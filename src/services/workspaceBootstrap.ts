import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  type WorkspaceBootstrapSelection,
} from "../constants/workspaceBootstrapAddons";
import { bootstrapTrellisIfMissing } from "./trellisBootstrap";

export type { WorkspaceBootstrapSelection };
export { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 在创建 Workspace 前按 Wise Trellis 开关初始化根目录。 */
export async function runWorkspaceBootstrap(
  rootPath: string,
  selection: WorkspaceBootstrapSelection = DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
): Promise<void> {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    throw new Error("请先选择工作区根目录");
  }

  if (selection.trellis) {
    try {
      await bootstrapTrellisIfMissing(trimmed);
    } catch (err: unknown) {
      throw new Error(`Trellis 初始化失败：${errorMessage(err)}`);
    }
  }
}
