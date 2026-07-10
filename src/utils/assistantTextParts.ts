import type { MessagePart } from "../types";

/** 从 parts 提取全部 text 正文块（顺序与磁盘 JSONL blocksToParts 一致）。 */
export function assistantTextBodiesFromParts(parts: readonly MessagePart[]): string[] {
  return parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text);
}

/**
 * 多 text part 正文拼接：规则与 {@link buildMergedTextGroups} 的 joinedText 对齐，
 * 供 content 字段、result 前缀对齐、orphan 检测等复用。
 */
export function joinAssistantTextPartBodies(bodies: readonly string[]): string {
  return bodies
    .map((body, index) => {
      if (!body.trim()) return "";
      if (index === 0) return bodies.length === 1 ? body.trim() : body.trimEnd();
      return index === bodies.length - 1 ? body.trim() : body.trim();
    })
    .filter((segment) => segment.length > 0)
    .join("\n\n");
}

export function assistantTextJoinedFromParts(parts: readonly MessagePart[]): string {
  return joinAssistantTextPartBodies(assistantTextBodiesFromParts(parts));
}

/** 流式/磁盘共用的段数统计（与 looksLikeLongFormChatMarkdown 一致）。 */
export function countAssistantTextParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => block.trim()).length;
}

/**
 * 单条 incoming text 是否应另起 part（而非与末条 text 无分隔拼接）。
 * 用于 content_block 边界、assistant 快照间的新段落等场景。
 */
export function shouldStartNewAssistantTextPart(
  existingLastText: string | undefined,
  incoming: string,
): boolean {
  if (!existingLastText?.length || !incoming.length) return false;
  if (existingLastText.endsWith("\n\n") || incoming.startsWith("\n\n")) return true;

  const prev = existingLastText.trimEnd();
  const next = incoming.trimStart();
  if (!prev || !next) return false;

  // 上一块已结束于句读/冒号/换行，incoming 以块级 Markdown 结构开头 → 新段
  if (
    /[\n.!?。！？:：]$/.test(prev)
    && /^(\#{1,6}\s|[-*+]\s|\d+\.\s|\*\*[^*\n]{2,64}\*\*)/m.test(next)
  ) {
    return true;
  }

  return false;
}
