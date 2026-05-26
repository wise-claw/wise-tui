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
 * 对文件/符号且存在 range 时传 `code -g path:line:col` 以定位到定义处（行列为 1-based，与侧栏行号一致）；
 * 对目录节点：打开仓库根，并在 VS Code 系 CLI 下用 `cursor 根 -g 子文件:1:1` 在整仓上下文中靠近该目录。
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

    /** 目录节点：打开整个仓库，并在 VS Code 系下用 `-g` 跳到该目录下首个源文件以靠近目录 */
    if (node.kind === "folder") {
      const rawPath = node.path.trim();
      const rel =
        rawPath === "" || rawPath === "." || rawPath === "/" ? null : rawPath.replace(/^[/\\]+/, "");
      if (target.kind === "command") {
        const cmd = target.command?.trim();
        if (!cmd) {
          message.warning("打开方式未配置有效命令");
          return;
        }
        await openWorkspaceIn(root, {
          command: cmd,
          args: target.args ?? [],
          graphIdeFolderRelative: rel,
        });
      } else {
        const appName = target.appName?.trim();
        if (!appName) {
          message.warning("打开方式未配置有效应用");
          return;
        }
        await openWorkspaceIn(root, {
          appName,
          args: target.args ?? [],
          graphIdeFolderRelative: rel,
        });
      }
      return;
    }

    const rawPath = node.path.trim();
    const rel =
      rawPath === "" || rawPath === "/" || rawPath === "."
        ? null
        : rawPath.replace(/^[/\\]+/, "");

    const canGoto =
      (node.kind === "file" || node.kind === "symbol" || node.kind === "api_operation" || node.kind === "schema")
      && Boolean(node.range);

    let gotoLine = 1;
    let gotoColumn = 1;
    if (canGoto && node.range) {
      gotoLine = node.range.start.line + 1;
      gotoColumn = node.range.start.column + 1;
    }

    const ideOpen =
      rel != null
        ? { ideGotoRelative: rel, gotoLine, gotoColumn }
        : { gotoLine, gotoColumn };

    if (target.kind === "command") {
      const cmd = target.command?.trim();
      if (!cmd) {
        message.warning("打开方式未配置有效命令");
        return;
      }
      await openWorkspaceIn(rel != null ? root : joinRepositoryAbsolutePath(root, node.path), {
        command: cmd,
        args: target.args ?? [],
        ...ideOpen,
      });
    } else {
      const appName = target.appName?.trim();
      if (!appName) {
        message.warning("打开方式未配置有效应用");
        return;
      }
      await openWorkspaceIn(rel != null ? root : joinRepositoryAbsolutePath(root, node.path), {
        appName,
        args: target.args ?? [],
        ...ideOpen,
      });
    }
  } catch (e) {
    message.error(String(e));
  }
}
