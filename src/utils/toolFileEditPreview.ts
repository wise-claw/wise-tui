import type { ToolUsePart } from "../types";
import { monacoLanguageFromRepositoryPath } from "./repositoryFilePreview";
import {
  buildPatchDiffLines,
  type PatchDiffLine,
} from "./sessionFeedbackConfigPatchDiff";

const FILE_EDIT_TOOL_NAMES = new Set([
  "edit",
  "edit_file",
  "write",
  "write_file",
  "multiedit",
  "multi_edit",
  "notebookedit",
  "notebook_edit",
  "search_replace",
  "searchreplace",
  "strreplace",
  "str_replace",
  "str_replace_editor",
  // Codex CLI / Codex RPC 的补丁工具。
  "apply_patch",
  "applypatch",
  // Gemini CLI 的文件替换工具。
  "replace",
  "create_file",
  "delete",
  "delete_file",
]);

const EDITED_FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "target_file",
  "targetFile",
  "filepath",
  "absolute_path",
  "absolutePath",
  "uri",
  "file",
  "notebook_path",
  "notebookPath",
  "target_notebook",
] as const;

const WRITE_CONTENT_KEYS = [
  "content",
  "contents",
  "fileText",
  "file_text",
  "new_string",
  "newString",
  "text",
  "data",
  "streamContent",
] as const;

export interface ToolFileEditPreviewLine {
  kind: "add" | "remove" | "same";
  text: string;
  /** 旧文件行号；新增行没有旧行号。 */
  oldLine: number | null;
  /** 新文件行号；删除行没有新行号。 */
  newLine: number | null;
}

export type FileEditDiffRow =
  | { type: "line"; line: ToolFileEditPreviewLine; key: string }
  | { type: "fold"; count: number; lines: ToolFileEditPreviewLine[]; key: string };

/** 变更两侧保留的上下文行数，和常见 unified diff 一致。 */
const DIFF_CONTEXT_LINES = 3;
/** 短于这个长度的未改动区间直接展开，避免「1 行未修改」条。 */
const MIN_FOLD_LINES = 4;

export interface ToolFileEditPreview {
  filePath: string;
  fileName: string;
  addedLineCount: number;
  removedLineCount: number;
  lines: ToolFileEditPreviewLine[];
  language: string;
  truncated: boolean;
}

const MAX_PREVIEW_LINES = 2500;

function pickInputString(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/**
 * ACP 适配器有时把工具名写成标题，例如 `Edit \`/repo/src/a.ts\``。
 * 这类名字仍是文件编辑，不能按路径尾段丢掉。
 */
function fileEditTitleKind(name: string): string {
  const raw = name.trim();
  if (/^edit(ed)?\b/i.test(raw)) return "edit";
  if (/^(write|wrote)\b/i.test(raw)) return "write";
  if (/^delete(d)?\b/i.test(raw)) return "delete";
  if (/^str_?replace\b/i.test(raw)) return "strreplace";
  if (/^apply(?:patch|\s+patch)|applied patch\b/i.test(raw)) return "apply_patch";
  return "";
}

/** 归一化工具名尾段，兼容 `mcp__server__write_file`、`functions.edit` 等前缀。 */
export function canonicalFileEditToolName(name: string): string {
  const titled = fileEditTitleKind(name);
  if (titled) return titled;
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "unknown") return "";
  const mcpTail = normalized.split("__").pop() ?? normalized;
  return mcpTail.split(/[./:]/).pop() ?? mcpTail;
}

export function isFileEditToolName(name: string): boolean {
  const canonical = canonicalFileEditToolName(name);
  return canonical.length > 0 && FILE_EDIT_TOOL_NAMES.has(canonical);
}

function isWriteLikeToolName(canonical: string): boolean {
  return canonical === "write" || canonical === "write_file" || canonical === "create_file";
}

function isDeleteLikeToolName(canonical: string): boolean {
  return canonical === "delete" || canonical === "delete_file";
}

function normalizeEditedFilePath(raw: string): string {
  let path = raw.trim();
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\//i, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      // 非法转义保持去协议后的原文。
    }
  }
  return path;
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

function numberDiffLines(
  lines: readonly PatchDiffLine[],
  startOld = 1,
  startNew = 1,
): ToolFileEditPreviewLine[] {
  let oldLine = startOld;
  let newLine = startNew;
  return lines.map((line) => {
    if (line.kind === "remove") {
      const row: ToolFileEditPreviewLine = { kind: "remove", text: line.text, oldLine, newLine: null };
      oldLine += 1;
      return row;
    }
    if (line.kind === "add") {
      const row: ToolFileEditPreviewLine = { kind: "add", text: line.text, oldLine: null, newLine };
      newLine += 1;
      return row;
    }
    const row: ToolFileEditPreviewLine = { kind: "same", text: line.text, oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return row;
  });
}

export function buildFileTextDiffLines(before: string, after: string): ToolFileEditPreviewLine[] {
  if (!before && after) return linesFromAddedContent(after);
  if (before && !after) return linesFromRemovedContent(before);
  return numberDiffLines(buildPatchDiffLines(before, after));
}

function editPreviewLinesFromStrings(oldString: string, newString: string): ToolFileEditPreviewLine[] {
  return buildFileTextDiffLines(oldString, newString);
}

/** 同一文件、且工具入参里没有差异正文时，只保留一张卡片，避免重复的空文件名。 */
export function dedupePathOnlyFileEditParts<T extends { part: ToolUsePart }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const preview = extractToolFileEditPreview(item.part);
    if (preview && preview.lines.length === 0) {
      const key = preview.filePath.replace(/\\/g, "/");
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

/**
 * 把完整 diff 收成「变更 + 上下文」，中间大段未改动行折成可展开条。
 * 上下文为 3 行时，文件开头 17 行未改、第 21 行有改动，会得到「17 行未修改」再从第 18 行画起。
 */
export function groupFileEditDiffRows(
  lines: readonly ToolFileEditPreviewLine[],
  context = DIFF_CONTEXT_LINES,
): FileEditDiffRow[] {
  if (lines.length === 0) return [];
  const changed: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.kind !== "same") changed.push(index);
  }
  if (changed.length === 0) {
    if (lines.length < MIN_FOLD_LINES) {
      return lines.map((line, index) => ({ type: "line" as const, line, key: `l${index}` }));
    }
    return [{ type: "fold", count: lines.length, lines: [...lines], key: "f0" }];
  }

  const visible = new Set<number>();
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let cursor = from; cursor <= to; cursor += 1) visible.add(cursor);
  }

  const rows: FileEditDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (visible.has(index)) {
      rows.push({ type: "line", line: lines[index]!, key: `l${index}` });
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && !visible.has(index)) index += 1;
    const hidden = lines.slice(start, index);
    if (hidden.length < MIN_FOLD_LINES) {
      for (let offset = 0; offset < hidden.length; offset += 1) {
        rows.push({ type: "line", line: hidden[offset]!, key: `l${start + offset}` });
      }
    } else {
      rows.push({ type: "fold", count: hidden.length, lines: hidden, key: `f${start}` });
    }
  }
  return rows;
}

function linesFromMultiEdit(input: Record<string, unknown>): ToolFileEditPreviewLine[] | null {
  const edits = input.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const combined: ToolFileEditPreviewLine[] = [];
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

function truncatePreviewLines(lines: ToolFileEditPreviewLine[]): { lines: ToolFileEditPreviewLine[]; truncated: boolean } {
  if (lines.length <= MAX_PREVIEW_LINES) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(0, MAX_PREVIEW_LINES), truncated: true };
}

function filePathFromApplyPatchCommand(command: string): string {
  for (const rawLine of command.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const header = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/i);
    if (header?.[1]?.trim()) return header[1].trim();
    const unified = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (unified?.[1] && unified[1] !== "/dev/null" && !unified[1].startsWith("/dev/null")) {
      return unified[1].trim();
    }
  }
  return "";
}

function resolveEditedFilePath(part: ToolUsePart, input: Record<string, unknown>): string {
  const fromInput = pickInputString(input, EDITED_FILE_PATH_KEYS);
  if (fromInput) return normalizeEditedFilePath(fromInput);
  const command = pickInputString(input, ["command", "patch", "diff", "unified_diff", "unifiedDiff"]);
  const fromPatch = command ? filePathFromApplyPatchCommand(command) : "";
  if (fromPatch) return normalizeEditedFilePath(fromPatch);
  const location = part.locations?.find((item) => item.path?.trim());
  if (location?.path) return normalizeEditedFilePath(location.path);
  const titled = part.name.match(/`([^`]+)`/);
  if (titled?.[1]?.trim()) return normalizeEditedFilePath(titled[1]);
  return "";
}

function patchHasDiffMarkers(command: string): boolean {
  return (
    command.includes("\n@@") ||
    command.startsWith("@@") ||
    command.includes("*** ") ||
    /^[+-]/m.test(command)
  );
}

function applyPatchKind(input: Record<string, unknown>): string {
  const kind = input.kind;
  if (typeof kind === "string") return kind.trim().toLowerCase();
  if (kind && typeof kind === "object" && !Array.isArray(kind)) {
    const type = (kind as Record<string, unknown>).type;
    if (typeof type === "string") return type.trim().toLowerCase();
  }
  return "";
}

/** Codex `fileChange` 的 add/delete 补丁是全文，没有 `+`/`-` 前缀。 */
function applyPatchPreviewLines(input: Record<string, unknown>): ToolFileEditPreviewLine[] | null {
  const command = pickInputString(input, ["command", "patch", "diff", "unified_diff", "unifiedDiff"]);
  if (!command) return null;
  if (patchHasDiffMarkers(command)) {
    const lines = linesFromApplyPatch(command);
    return lines.length > 0 ? lines : null;
  }
  const kind = applyPatchKind(input);
  if (kind === "delete" || kind === "remove") return linesFromRemovedContent(command);
  if (kind === "add" || kind === "create" || kind === "write" || kind === "update") {
    return linesFromAddedContent(command);
  }
  const lines = linesFromApplyPatch(command);
  return lines.length > 0 ? lines : null;
}

function linesFromAddedContent(content: string): ToolFileEditPreviewLine[] {
  return content.replace(/\r\n/g, "\n").split("\n").map((text, index) => ({
    kind: "add" as const,
    text,
    oldLine: null,
    newLine: index + 1,
  }));
}

function linesFromRemovedContent(content: string): ToolFileEditPreviewLine[] {
  return content.replace(/\r\n/g, "\n").split("\n").map((text, index) => ({
    kind: "remove" as const,
    text,
    oldLine: index + 1,
    newLine: null,
  }));
}

function oldNewPreviewLines(input: Record<string, unknown>): ToolFileEditPreviewLine[] | null {
  const oldString = pickInputString(input, ["old_string", "oldString", "old_text", "oldText"]);
  const newString = pickInputString(input, [
    "new_string",
    "newString",
    "new_text",
    "newText",
    "replace_string",
    "content",
    "contents",
    "fileText",
    "file_text",
  ]);
  if (!newString && !oldString) return null;
  return editPreviewLinesFromStrings(oldString, newString);
}

function patchPreviewLines(input: Record<string, unknown>): ToolFileEditPreviewLine[] | null {
  const command = pickInputString(input, ["command", "patch", "diff", "unified_diff", "unifiedDiff"]);
  if (!command) return null;
  const lines = linesFromApplyPatch(command);
  return lines.length > 0 ? lines : null;
}

/**
 * 解析 Codex `apply_patch` 的文本：返回按行排列的 (old | new) 差异预览。
 * 支持 `*** Update File: <path>` / `*** Add File:` / `*** Delete File:` 三种块。
 */
function linesFromApplyPatch(command: string): ToolFileEditPreviewLine[] {
  const result: ToolFileEditPreviewLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const rawLine of command.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) continue;
    if (line.startsWith("*** ")) continue;
    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ kind: "add", text: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      result.push({ kind: "remove", text: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      result.push({ kind: "same", text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      result.push({ kind: "same", text: line, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return result;
}

export function extractToolFileEditPreview(part: ToolUsePart): ToolFileEditPreview | null {
  if (!isFileEditToolName(part.name)) return null;
  // 流式中断 / 未完成的 tool_use 常见 input 为 null/undefined；缺省为空对象，改从 locations / 补丁头取路径。
  const rawInput = part.input;
  const input =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  const filePath = resolveEditedFilePath(part, input);
  if (!filePath) return null;

  const toolName = canonicalFileEditToolName(part.name);
  let diffLines: ToolFileEditPreviewLine[] | null = null;

  if (isWriteLikeToolName(toolName)) {
    const content = pickInputString(input, WRITE_CONTENT_KEYS);
    diffLines = content ? linesFromAddedContent(content) : oldNewPreviewLines(input) ?? patchPreviewLines(input);
  } else if (isDeleteLikeToolName(toolName)) {
    const removed =
      pickInputString(input, ["old_string", "oldString", "content", "contents", "text"]) ||
      pickInputString(input, WRITE_CONTENT_KEYS);
    diffLines = removed ? linesFromRemovedContent(removed) : null;
  } else if (toolName === "multiedit" || toolName === "multi_edit" || toolName === "notebookedit" || toolName === "notebook_edit") {
    diffLines = linesFromMultiEdit(input) ?? oldNewPreviewLines(input) ?? patchPreviewLines(input);
  } else if (toolName === "apply_patch" || toolName === "applypatch") {
    diffLines = applyPatchPreviewLines(input);
  } else {
    diffLines = oldNewPreviewLines(input) ?? patchPreviewLines(input);
  }

  const previewLines = diffLines ?? [];
  const addedLineCount = previewLines.filter((line) => line.kind === "add").length;
  const removedLineCount = previewLines.filter((line) => line.kind === "remove").length;
  const { lines, truncated } = truncatePreviewLines(previewLines);

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

/** 一次工具调用改多个文件时拆开，让每张变更卡片对应一个路径。 */
export function expandFileEditToolParts(part: ToolUsePart): ToolUsePart[] {
  const raw = part.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [part];
  const edits = (raw as Record<string, unknown>).edits;
  if (!Array.isArray(edits) || edits.length < 2) return [part];
  const out: ToolUsePart[] = [];
  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue;
    out.push({
      ...part,
      id: `${part.id}:${index}`,
      name: part.name.trim() ? part.name : "Edit",
      input: edit as Record<string, unknown>,
    });
  }
  return out.length > 0 ? out : [part];
}
