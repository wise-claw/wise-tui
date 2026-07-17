import type { ToolUsePart } from "../types";
import {
  extractToolFileEditPreview,
  isFileEditToolName,
} from "./toolFileEditPreview";

export type ToolActivityKind = "explore" | "edit" | "search" | "command" | "tool";

export interface ToolGroupActivitySummary {
  /** 主文案，如「探索了 SKILL.md，2 次搜索，执行 1 条命令」 */
  label: string;
  addedLines: number;
  removedLines: number;
  errorCount: number;
  running: boolean;
  /** 参与摘要的工具总数（不含空名结果行） */
  toolCount: number;
}

function pickPathBasename(input: Record<string, unknown>): string {
  for (const key of ["file_path", "path", "target_file", "target_directory", "root"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const normalized = value.replace(/\\/g, "/");
      const base = normalized.split("/").filter(Boolean).pop();
      return base || normalized;
    }
  }
  return "";
}

export function classifyToolActivity(part: ToolUsePart): ToolActivityKind | null {
  const raw = part.name.trim();
  if (!raw || raw.toLowerCase() === "unknown") return null;
  const name = raw.toLowerCase();

  if (isFileEditToolName(name)) return "edit";
  if (
    name === "read" ||
    name === "glob" ||
    name === "list_dir" ||
    name === "ls" ||
    name === "view_image" ||
    name.startsWith("codegraph_")
  ) {
    return "explore";
  }
  if (name === "grep" || name === "rg" || name === "web_search" || name === "websearch") {
    return "search";
  }
  if (name === "bash" || name === "exec" || name === "shell") return "command";
  return "tool";
}

function joinZhParts(parts: string[]): string {
  return parts.filter(Boolean).join("，");
}

/**
 * 将连续 tool_use 收成 Cursor 风格单行摘要（中文）。
 * 例：探索了 SKILL.md，2 次搜索，2 个工具，执行 1 条命令
 *     编辑了 5 个文件，探索了 2 个文件 +79 -56
 */
export function buildToolGroupActivitySummary(
  parts: readonly ToolUsePart[],
): ToolGroupActivitySummary {
  let explore = 0;
  let edit = 0;
  let search = 0;
  let command = 0;
  let tool = 0;
  let addedLines = 0;
  let removedLines = 0;
  let errorCount = 0;
  let running = false;
  let firstExploreName = "";
  let firstEditName = "";

  for (const part of parts) {
    if (part.status === "running" || part.status === "pending") running = true;
    if (part.status === "error" || Boolean(part.error?.trim())) errorCount += 1;

    const kind = classifyToolActivity(part);
    if (!kind) continue;

    const basename = pickPathBasename((part.input ?? {}) as Record<string, unknown>);
    if (kind === "explore") {
      explore += 1;
      if (!firstExploreName && basename) firstExploreName = basename;
    } else if (kind === "edit") {
      edit += 1;
      if (!firstEditName && basename) firstEditName = basename;
      const preview = extractToolFileEditPreview(part);
      if (preview) {
        addedLines += preview.addedLineCount;
        removedLines += preview.removedLineCount;
      }
    } else if (kind === "search") {
      search += 1;
    } else if (kind === "command") {
      command += 1;
    } else {
      tool += 1;
    }
  }

  const toolCount = explore + edit + search + command + tool;
  const segments: string[] = [];

  if (edit > 0) {
    if (edit === 1 && firstEditName) {
      segments.push(`编辑了 ${firstEditName}`);
    } else {
      segments.push(`编辑了 ${edit} 个文件`);
    }
  }

  if (explore > 0) {
    if (explore === 1 && firstExploreName) {
      segments.push(`探索了 ${firstExploreName}`);
    } else if (edit > 0) {
      segments.push(`探索了 ${explore} 个文件`);
    } else if (firstExploreName && explore > 1) {
      segments.push(`探索了 ${firstExploreName} 等 ${explore} 个文件`);
    } else if (firstExploreName) {
      segments.push(`探索了 ${firstExploreName}`);
    } else {
      segments.push(`探索了 ${explore} 个文件`);
    }
  }

  if (search > 0) {
    segments.push(search === 1 ? "1 次搜索" : `${search} 次搜索`);
  }

  if (tool > 0) {
    segments.push(tool === 1 ? "1 个工具" : `${tool} 个工具`);
  }

  if (command > 0) {
    segments.push(command === 1 ? "执行 1 条命令" : `执行 ${command} 条命令`);
  }

  let label = joinZhParts(segments);
  if (!label) {
    label = toolCount > 0 ? `${toolCount} 个工具` : "工具调用";
  }
  if (running) {
    label = `${label}…`;
  } else if (errorCount > 0) {
    label = `${label}，${errorCount} 失败`;
  }

  return {
    label,
    addedLines,
    removedLines,
    errorCount,
    running,
    toolCount,
  };
}
