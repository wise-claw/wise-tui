import type { ToolUsePart } from "../types";
import { monacoLanguageFromRepositoryPath } from "./repositoryFilePreview";
import {
  buildPatchDiffLines,
  compactPatchDiffLines,
  type PatchDiffLine,
} from "./sessionFeedbackConfigPatchDiff";

const FILE_EDIT_TOOL_NAMES = new Set([
  "edit",
  "edit_file",
  "write",
  "write_file",
  "multiedit",
  "notebookedit",
  "search_replace",
  "strreplace",
  "str_replace",
  // Codex CLI 的 `apply_patch` 工具。
  "apply_patch",
]);

export interface ToolFileEditPreviewLine {
  kind: "add" | "remove" | "same";
  text: string;
}

export interface ToolFileEditPreview {
  filePath: string;
  fileName: string;
  addedLineCount: number;
  removedLineCount: number;
  lines: ToolFileEditPreviewLine[];
  language: string;
  truncated: boolean;
}

const MAX_PREVIEW_LINES = 14;

function pickInputString(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

export function isFileEditToolName(name: string): boolean {
  return FILE_EDIT_TOOL_NAMES.has(name.trim().toLowerCase());
}

/** Cursor / Claude Code 编辑工具常见的无信息成功回执。 */
export function isToolEditNoiseOutput(output: string): boolean {
  const text = output.trim();
  if (!text) return true;
  if (/has been updated successfully/i.test(text)) return true;
  if (/file state is current/i.test(text)) return true;
  if (/^The file .+ has been (created|written|updated|saved)/i.test(text)) return true;
  if (/^Wrote contents to/i.test(text)) return true;
  if (/^Successfully (wrote|updated|created|saved)/i.test(text)) return true;
  if (/^File (written|updated|created|saved) successfully/i.test(text)) return true;
  if (/^(OK|ok|success|Success|done|Done)[.!]?$/.test(text)) return true;
  return false;
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** 将工具返回的绝对/相对路径规范化为仓库内相对路径。 */
export function relativePathInRepository(repositoryPath: string, filePath: string): string | null {
  const repo = repositoryPath.trim().replace(/[/\\]+$/, "");
  const file = filePath.trim();
  if (!repo || !file) return null;

  const repoNorm = repo.replace(/\\/g, "/");
  const fileNorm = file.replace(/\\/g, "/");

  if (fileNorm.startsWith(`${repoNorm}/`)) {
    return fileNorm.slice(repoNorm.length + 1);
  }
  if (!fileNorm.startsWith("/") && !/^[A-Za-z]:[/\\]/.test(fileNorm)) {
    return fileNorm.replace(/^[/\\]+/, "");
  }
  return null;
}

function editPreviewLinesFromStrings(oldString: string, newString: string): PatchDiffLine[] {
  if (!oldString && newString) {
    return newString.replace(/\r\n/g, "\n").split("\n").map((text) => ({ kind: "add" as const, text }));
  }
  const diffLines = buildPatchDiffLines(oldString, newString);
  return compactPatchDiffLines(diffLines, 1);
}

function linesFromMultiEdit(input: Record<string, unknown>): PatchDiffLine[] | null {
  const edits = input.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const combined: PatchDiffLine[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue;
    const row = edit as Record<string, unknown>;
    const oldString = pickInputString(row, ["old_string", "oldString", "old_text", "oldText"]);
    const newString = pickInputString(row, ["new_string", "newString", "new_text", "newText"]);
    if (!newString && !oldString) continue;
    combined.push(...editPreviewLinesFromStrings(oldString, newString));
  }
  return combined.length > 0 ? combined : null;
}

function truncatePreviewLines(lines: PatchDiffLine[]): { lines: PatchDiffLine[]; truncated: boolean } {
  if (lines.length <= MAX_PREVIEW_LINES) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(0, MAX_PREVIEW_LINES), truncated: true };
}

/**
 * 解析 Codex `apply_patch` 的文本：返回按行排列的 (old | new) 差异预览。
 * 支持 `*** Update File: <path>` / `*** Add File:` / `*** Delete File:` 三种块。
 */
function linesFromApplyPatch(command: string): PatchDiffLine[] {
  const result: PatchDiffLine[] = [];
  for (const rawLine of command.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) continue;
    if (line.startsWith("*** ")) continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      result.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      result.push({ kind: "remove", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      result.push({ kind: "same", text: line.slice(1) });
    } else {
      // 未带前缀的行（极少见）按 same 处理以保留上下文。
      result.push({ kind: "same", text: line });
    }
  }
  return result;
}

export function extractToolFileEditPreview(part: ToolUsePart): ToolFileEditPreview | null {
  if (!isFileEditToolName(part.name)) return null;
  // 流式中断 / 未完成的 tool_use 常见 input 为 null/undefined；不可直接下标访问。
  const rawInput = part.input;
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null;
  const input = rawInput as Record<string, unknown>;
  const filePath = pickInputString(input, ["file_path", "path", "target_file"]);
  if (!filePath) return null;

  const toolName = part.name.trim().toLowerCase();
  let diffLines: PatchDiffLine[] | null = null;

  if (toolName === "write" || toolName === "write_file") {
    const content = pickInputString(input, ["content", "contents", "new_string", "newString", "text", "data"]);
    if (!content) return null;
    diffLines = content.replace(/\r\n/g, "\n").split("\n").map((text) => ({ kind: "add" as const, text }));
  } else if (toolName === "multiedit" || toolName === "notebookedit") {
    diffLines = linesFromMultiEdit(input);
  } else if (toolName === "apply_patch") {
    const command = pickInputString(input, ["command", "patch", "diff"]);
    if (!command) return null;
    diffLines = linesFromApplyPatch(command);
  } else {
    const oldString = pickInputString(input, ["old_string", "oldString", "old_text", "oldText"]);
    const newString = pickInputString(input, [
      "new_string",
      "newString",
      "new_text",
      "newText",
      "replace_string",
      "content",
    ]);
    if (!newString && !oldString) return null;
    diffLines = editPreviewLinesFromStrings(oldString, newString);
  }

  if (!diffLines || diffLines.length === 0) return null;

  const addedLineCount = diffLines.filter((line) => line.kind === "add").length;
  const removedLineCount = diffLines.filter((line) => line.kind === "remove").length;
  const { lines, truncated } = truncatePreviewLines(diffLines);

  return {
    filePath,
    fileName: fileNameFromPath(filePath),
    addedLineCount,
    removedLineCount,
    lines,
    language: monacoLanguageFromRepositoryPath(filePath),
    truncated,
  };
}
