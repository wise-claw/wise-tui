import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  hasRenderableChatMessageBody,
  isToolOnlyUserMessage,
} from "./claudeChatMessageDisplay";
import { extractToolFileEditPreview } from "./toolFileEditPreview";

export type TurnFileChangeEntry = {
  filePath: string;
  fileName: string;
  addedLineCount: number;
  removedLineCount: number;
};

export type TurnFileChangeSummaryPlacement = {
  /** 插在 folded 消息列表该下标的 message 行之后。 */
  afterOriginalIndex: number;
  turnStartTimestamp: number;
  files: TurnFileChangeEntry[];
  key: string;
};

function normalizeFilePathKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/");
}

function fileNameFromPath(filePath: string): string {
  const normalized = normalizeFilePathKey(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** 从一轮消息中聚合 file-edit 工具变更（同路径合并 +/-）。 */
export function collectTurnFileChanges(
  messages: readonly ClaudeMessage[],
): TurnFileChangeEntry[] {
  const byPath = new Map<string, TurnFileChangeEntry>();

  for (const msg of messages) {
    if (msg.role !== "assistant" && msg.role !== "user") continue;
    const parts = msg.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part.type !== "tool_use") continue;
      const preview = extractToolFileEditPreview(part);
      if (!preview) continue;
      const key = normalizeFilePathKey(preview.filePath);
      if (!key) continue;
      const existing = byPath.get(key);
      if (existing) {
        existing.addedLineCount += preview.addedLineCount;
        existing.removedLineCount += preview.removedLineCount;
      } else {
        byPath.set(key, {
          filePath: preview.filePath,
          fileName: preview.fileName || fileNameFromPath(preview.filePath),
          addedLineCount: preview.addedLineCount,
          removedLineCount: preview.removedLineCount,
        });
      }
    }
  }

  return Array.from(byPath.values());
}

function isRenderableUserTurnBoundary(msg: ClaudeMessage): boolean {
  return msg.role === "user" && !isToolOnlyUserMessage(msg);
}

function fingerprintFiles(files: readonly TurnFileChangeEntry[]): string {
  return files
    .map(
      (f) =>
        `${normalizeFilePathKey(f.filePath)}:+${f.addedLineCount}-:${f.removedLineCount}`,
    )
    .join("|");
}

/**
 * 扫描 folded 消息，按可展示 user 消息切轮次，产出应插入的「修改总结」元数据。
 * 当前仍在流式的末轮（sessionStatus 为 running/connecting）不插入。
 */
export function buildTurnFileChangeSummaryPlacements(
  foldedMessages: readonly ClaudeMessage[],
  sessionStatus: ClaudeSession["status"],
): TurnFileChangeSummaryPlacement[] {
  if (foldedMessages.length === 0) return [];

  const turnStarts: number[] = [];
  for (let i = 0; i < foldedMessages.length; i += 1) {
    if (isRenderableUserTurnBoundary(foldedMessages[i]!)) {
      turnStarts.push(i);
    }
  }
  if (turnStarts.length === 0) return [];

  const sessionBusy = sessionStatus === "running" || sessionStatus === "connecting";
  const placements: TurnFileChangeSummaryPlacement[] = [];

  for (let t = 0; t < turnStarts.length; t += 1) {
    const start = turnStarts[t]!;
    const endExclusive =
      t + 1 < turnStarts.length ? turnStarts[t + 1]! : foldedMessages.length;
    const isLastTurn = t === turnStarts.length - 1;
    if (sessionBusy && isLastTurn) continue;

    const turnMessages = foldedMessages.slice(start, endExclusive);
    const files = collectTurnFileChanges(turnMessages);
    if (files.length === 0) continue;

    // 插在本轮最后一条「有可展示 body」的消息之后；若本轮无可展示消息则跳过。
    let afterOriginalIndex = -1;
    for (let i = endExclusive - 1; i >= start; i -= 1) {
      if (hasRenderableChatMessageBody(foldedMessages[i]!)) {
        afterOriginalIndex = i;
        break;
      }
    }
    if (afterOriginalIndex < 0) continue;

    const turnStartTimestamp = foldedMessages[start]?.timestamp ?? 0;
    placements.push({
      afterOriginalIndex,
      turnStartTimestamp,
      files,
      key: `files-changed:${turnStartTimestamp}:${fingerprintFiles(files)}`,
    });
  }

  return placements;
}
