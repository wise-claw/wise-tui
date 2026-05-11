import { mergeAssistantParts } from "../services/claudeStreamAssembler";
import {
  extractInitSessionIdFromInvocationStdoutLines,
  extractPartsFromStreamLine,
} from "../services/claudeStreamParser";
import type { MessagePart, TextPart } from "../types";

/**
 * 参与 `assemblePartsFromStdoutLines` 解析的最近行数上限，避免巨量 stream-json 一次性卡死主线程。
 * 与 `BackgroundInvocationDock`、直连批量详情 Drawer 共用。
 */
export const MAX_STDOUT_LINES_FOR_STREAM_PARTS = 600;

/**
 * 将后台子进程 stdout 的逐行 stream-json 合并为与会话列表相同的 MessagePart 序列。
 */
export function assemblePartsFromStdoutLines(lines: readonly string[]): MessagePart[] {
  let parts: MessagePart[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const { parts: incoming, isInit } = extractPartsFromStreamLine(trimmed);
    if (isInit || incoming.length === 0) continue;
    parts = mergeAssistantParts(parts, incoming);
  }
  return parts;
}

function tryPrettyJsonOneLine(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** 多行各自为合法 JSON（如 stream-json 多帧）时合并排版；否则返回 null */
function tryPrettyNdjsonLines(lines: readonly string[]): string | null {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const pretties: string[] = [];
  for (const l of trimmed) {
    const p = tryPrettyJsonOneLine(l);
    if (!p) return null;
    pretties.push(p);
  }
  return pretties.join("\n\n");
}

function isStreamJsonInitLine(line: string): boolean {
  return extractPartsFromStreamLine(line.trim()).isInit;
}

/**
 * 与 {@link assemblePartsFromStdoutLines} 相同解析，但若仅有 `system`/`init` 等被跳过的帧，
 * UI 会回退成「说明 + 排版后的 JSON」，避免执行记录里出现一整条难读的单行 JSON。
 */
export function assemblePartsFromStdoutLinesForDisplay(lines: readonly string[]): MessagePart[] {
  const parts = assemblePartsFromStdoutLines(lines);
  if (parts.length > 0) return parts;

  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return [];

  if (nonEmpty.every(isStreamJsonInitLine)) {
    const sid = extractInitSessionIdFromInvocationStdoutLines(lines);
    const head = sid
      ? `**Claude Code 子进程已启动**，会话 id \`${sid}\`。以下为 stream-json 的 \`system\`/\`init\` 初始化帧（已缩进排版），模型正文会在后续输出到达后出现在下方。`
      : "**Claude Code 子进程已启动**。以下为 stream-json 的 \`system\`/\`init\` 初始化帧（已缩进排版）：";
    const body = nonEmpty.map((line) => tryPrettyJsonOneLine(line) ?? line).join("\n\n");
    return [{ type: "text", text: `${head}\n\n\`\`\`json\n${body}\n\`\`\`` }];
  }

  const sansInit = nonEmpty.filter((line) => !isStreamJsonInitLine(line));
  if (sansInit.length > 0) {
    const tailParts = assemblePartsFromStdoutLines(sansInit);
    if (tailParts.length > 0) return tailParts;
    const nd = tryPrettyNdjsonLines(sansInit);
    if (nd) {
      return [{ type: "text", text: `**原始输出**（多行 JSON，已排版）：\n\n\`\`\`json\n${nd}\n\`\`\`` }];
    }
    const single = tryPrettyJsonOneLine(sansInit.join("\n"));
    if (single) {
      return [{ type: "text", text: `**原始输出**（已格式化为 JSON）：\n\n\`\`\`json\n${single}\n\`\`\`` }];
    }
    return [{ type: "text", text: sansInit.join("\n") }];
  }

  const join = nonEmpty.join("\n");
  const ndAll = tryPrettyNdjsonLines(nonEmpty);
  if (ndAll) {
    return [{ type: "text", text: `**原始输出**（多行 JSON，已排版）：\n\n\`\`\`json\n${ndAll}\n\`\`\`` }];
  }
  const singleAll = tryPrettyJsonOneLine(join);
  if (singleAll) {
    return [{ type: "text", text: `**原始输出**（已格式化为 JSON）：\n\n\`\`\`json\n${singleAll}\n\`\`\`` }];
  }
  return [{ type: "text", text: join }];
}

export function plainTextFromMessageParts(parts: readonly MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}
