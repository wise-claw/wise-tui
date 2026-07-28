import type { MessagePart } from "../types";

/** 从 parts 提取全部 text 正文块（顺序与磁盘 JSONL blocksToParts 一致）。 */
export function assistantTextBodiesFromParts(parts: readonly MessagePart[]): string[] {
  return parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text);
}

/**
 * 相邻 text part 是否像流式 token 碎片（误拆成独立 part），应无分隔拼接。
 * 典型：拉丁 BPE（"Inc"+"ubation"）、中文逐字/短词碎片、CJK→拉丁无空格过渡。
 * 真·段落边界仍走 `\n\n`。
 *
 * 判定只看接合处两侧，不因「累积串里已有空格/换行」整段判否——否则一旦误插 `\n\n`
 * 会污染后续所有碎片，渲染成一词一行竖排。
 */
export function isLikelyStreamTextFragment(prev: string, next: string): boolean {
  if (!prev.length || !next.length) return false;
  if (shouldStartNewAssistantTextPart(prev, next)) return false;
  // 接合处已是显式换行 → 真段落/行边界
  if (prev.endsWith("\n") || next.startsWith("\n")) return false;
  // next 含空白 → 短语级正文，不是 token 碎片
  if (/\s/.test(next)) return false;
  // prev 以空白结尾 → 词界已在，勿与下一 token 黏死
  if (/\s$/.test(prev)) return false;

  // 拉丁 BPE 子词：Inc + ubation（边界两侧皆为标识符字符）
  if (/[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next)) return true;

  // 中文碎片：宜紧，避免把「第一段 / 第二段」等短段误拼。
  // - next 1～2 字：常见逐字/双字 delta
  // - prev 本身很短（≤2）且 next≤8：允许「党」+「费申请」这类续写
  if (/[\u3400-\u9fff]$/.test(prev) && /^[\u3400-\u9fff]+$/.test(next)) {
    if (next.length <= 2) return true;
    if (prev.length <= 2 && next.length <= 8) return true;
    return false;
  }

  // CJK → 拉丁无空格过渡（"目标"+"Inc"）；勿对称启用拉丁→CJK，
  // 否则 "intro"+"总结" 会被黏成一句。
  if (/[\u3400-\u9fff]$/.test(prev) && /^[A-Za-z0-9]/.test(next) && next.length <= 24) {
    return true;
  }

  // 单独标点续片
  if (/^[,.，。!！?？;；:：、…]+$/.test(next)) return true;
  return false;
}

/** 碎片拼接时的软空格：CJK→拉丁，或 Title Case 词界（Fund+Detail）。 */
function joinFragmentBodies(prev: string, next: string): string {
  if (/[\u3400-\u9fff]$/.test(prev) && /^[A-Za-z0-9]/.test(next)) return `${prev} ${next}`;
  if (/[a-z0-9]$/.test(prev) && /^[A-Z]/.test(next)) return `${prev} ${next}`;
  return prev + next;
}

/**
 * 多 text part 正文拼接：规则与 {@link buildMergedTextGroups} 的 joinedText 对齐，
 * 供 content 字段、result 前缀对齐、orphan 检测等复用。
 *
 * 段间默认 `\n\n`（磁盘多 block / 真段落）；流式误拆的 token 碎片则无分隔拼接，
 * 避免「一词一行」竖排。
 *
 * 碎片判定对「相邻原始段」进行，不用累积 out——防止误插的 `\n\n` 污染后续判定。
 */
export function joinAssistantTextPartBodies(bodies: readonly string[]): string {
  const segments = bodies
    .map((body, index) => {
      if (!body.trim()) return "";
      if (index === 0) return bodies.length === 1 ? body.trim() : body.trimEnd();
      return index === bodies.length - 1 ? body.trim() : body.trim();
    })
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0]!;

  let out = segments[0]!;
  for (let i = 1; i < segments.length; i += 1) {
    const prevSeg = segments[i - 1]!;
    const next = segments[i]!;
    if (isLikelyStreamTextFragment(prevSeg, next)) {
      out = joinFragmentBodies(out, next);
    } else {
      out = `${out.replace(/\n+$/g, "")}\n\n${next.replace(/^\n+/g, "")}`;
    }
  }
  return out;
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
