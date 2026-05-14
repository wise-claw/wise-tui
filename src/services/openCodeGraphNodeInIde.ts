import { message } from "antd";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../components/OpenAppMenu/constants";
import type { OpenAppTarget } from "../types";
import type { GraphNode } from "../types/codeKnowledgeGraph";
import { joinRepositoryAbsolutePath } from "../utils/repositoryPreviewBinary";
import { getOpenAppPreferenceSync } from "./openAppPreference";
import { openWorkspaceIn } from "./repository";
import { openWorkspaceWithOpenAppTarget } from "./openWorkspaceWithPreference";

function resolvePreferredIdeTarget(): OpenAppTarget | null {
  const selectedId = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  const list = DEFAULT_OPEN_APP_TARGETS;
  const selected = list.find((t) => t.id === selectedId);
  if (selected && selected.kind !== "finder") return selected;
  return list.find((t) => t.kind !== "finder") ?? null;
}

/**
 * 使用「打开方式」偏好（VS Code / Cursor 等）在系统 IDE 中打开图谱节点路径；
 * 对文件/符号且存在 range 时传 `code -g path:line:col` 以定位到定义处（行列为 1-based，与侧栏行号一致）。
 */
export async function openCodeGraphNodeInIde(
  repositoryPath: string | null | undefined,
  node: GraphNode,
): Promise<void> {
  const root = repositoryPath?.trim();
  if (!root) {
    message.warning("未选择仓库或路径无效");
    return;
  }
  const target = resolvePreferredIdeTarget();
  if (!target) {
    message.warning("未找到可用打开方式，请在「打开方式」中选择 VS Code 或 Cursor");
    return;
  }

  try {
    if (node.kind === "repo") {
      await openWorkspaceWithOpenAppTarget(root, target);
      return;
    }

    const rawPath = node.path.trim();
    const abs =
      rawPath === "" || rawPath === "/" || rawPath === "."
        ? root
        : joinRepositoryAbsolutePath(root, node.path);

    const canGoto =
      (node.kind === "file" || node.kind === "symbol" || node.kind === "api_operation" || node.kind === "schema")
      && Boolean(node.range);

    let gotoLine: number | undefined;
    let gotoColumn: number | undefined;
    if (canGoto && node.range) {
      gotoLine = node.range.start.line + 1;
      gotoColumn = node.range.start.column + 1;
    }

    if (target.kind === "command") {
      const cmd = target.command?.trim();
      if (!cmd) {
        message.warning("打开方式未配置有效命令");
        return;
      }
      await openWorkspaceIn(abs, {
        command: cmd,
        args: target.args ?? [],
        gotoLine,
        gotoColumn,
      });
    } else {
      const appName = target.appName?.trim();
      if (!appName) {
        message.warning("打开方式未配置有效应用");
        return;
      }
      await openWorkspaceIn(abs, {
        appName,
        args: target.args ?? [],
        gotoLine,
        gotoColumn,
      });
    }
  } catch (e) {
    message.error(String(e));
  }
}
