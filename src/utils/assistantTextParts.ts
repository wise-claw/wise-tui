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

/** 去重比对键：抹掉全部空白，使「分段位置不同但正文相同」的两份判为同一内容。 */
function textDedupeKey(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * 触发幂等去重的最小键长。短段（"好的。"、表格单元格）允许合法重复，
 * 只对成段正文做去重，避免把有意重复的短句吃掉。
 */
const TEXT_DEDUPE_MIN_KEY_LENGTH = 40;

/** 两段正文是否在忽略空白后完全相同。 */
export function sameAssistantTextIgnoringWhitespace(a: string, b: string): boolean {
  return textDedupeKey(a) === textDedupeKey(b);
}

/**
 * 多 text part 正文拼接：规则与 {@link buildMergedTextGroups} 的 joinedText 对齐，
 * 供 content 字段、result 前缀对齐、orphan 检测等复用。
 *
 * 段间默认 `\n\n`（磁盘多 block / 真段落）；流式误拆的 token 碎片则无分隔拼接，
 * 避免「一词一行」竖排。
 *
 * 碎片判定对「相邻原始段」进行，不用累积 out——防止误插的 `\n\n` 污染后续判定。
 *
 * 幂等去重（最后一道防线）：上游有多条路径可能让同一段正文进入 parts 两次
 * （result 整轮全文与 delta 累积、complete 兜底 preview、内存态与磁盘态合并）。
 * 这些路径各自的前缀对齐一旦因分段位置不同而失配，就会整段翻倍上屏。此处以
 * 「抹掉空白后的键」判定覆盖关系：已被覆盖的段丢弃，超集段整体取代已累积结果
 * （后到者通常来自 result 全文 / 磁盘快照等更权威来源，分段也更规整）。
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
  let outKey = textDedupeKey(out);
  for (let i = 1; i < segments.length; i += 1) {
    const prevSeg = segments[i - 1]!;
    const next = segments[i]!;
    const nextKey = textDedupeKey(next);
    if (
      outKey.length >= TEXT_DEDUPE_MIN_KEY_LENGTH
      && nextKey.length >= TEXT_DEDUPE_MIN_KEY_LENGTH
    ) {
      // 相等也走这支：后到者更权威、分段更规整，整体取代已累积结果。
      if (nextKey.includes(outKey)) {
        out = next;
        outKey = nextKey;
        continue;
      }
      if (outKey.includes(nextKey)) continue;
    }
    if (isLikelyStreamTextFragment(prevSeg, next)) {
      out = joinFragmentBodies(out, next);
    } else {
      out = `${out.replace(/\n+$/g, "")}\n\n${next.replace(/^\n+/g, "")}`;
    }
    outKey = textDedupeKey(out);
  }
  return out;
}

export function assistantTextJoinedFromParts(parts: readonly MessagePart[]): string {
  return joinAssistantTextPartBodies(assistantTextBodiesFromParts(parts));
}

/**
 * incoming 是否是「已累积正文的整轮全文快照」，而非增量续写。
 *
 * Cursor CLI `--stream-partial-output` 的 end-of-turn final flush、result 整轮文本、磁盘快照与内存态
 * 合并等路径都会把整轮正文整段再送一次。这类整段快照与**末条** text part 通常无前缀关系（增量一旦被
 * 段落边界切成多个 part 就必然如此），`mergeTextPartsByContainment` 会退化成拼接，整段正文翻倍上屏。
 *
 * 判定成立时调用方应另起 text part，交由 {@link joinAssistantTextPartBodies} 的整段去重收敛成权威全文，
 * 而不是拼进末条 part（拼进去后段落已混在同一个 part 内，整段去重再也看不见重复）。
 *
 * 比对抹掉空白以容忍分段位置差异；两侧都需达到 {@link TEXT_DEDUPE_MIN_KEY_LENGTH}，避免把短句的合法
 * 重复误判成快照。先按 incoming 长度短路，使 token 级增量不触发 O(n) 的 parts 拼接。
 */
export function isAssistantFullTextSnapshotOfParts(
  existingParts: readonly MessagePart[],
  incoming: string,
): boolean {
  const incomingKey = textDedupeKey(incoming);
  if (incomingKey.length < TEXT_DEDUPE_MIN_KEY_LENGTH) return false;
  const existingKey = textDedupeKey(assistantTextJoinedFromParts(existingParts));
  if (existingKey.length < TEXT_DEDUPE_MIN_KEY_LENGTH) return false;
  return incomingKey.includes(existingKey);
}

/** 流式/磁盘共用的段数统计（与 looksLikeLongFormChatMarkdown 一致）。 */
export function countAssistantTextParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => block.trim()).length;
}

/** 块级 Markdown 起始结构（标题 / 列表 / 有序列表 / 独立加粗小节标题）。 */
const BLOCK_MARKDOWN_HEAD_RE = /^(#{1,6}\s|[-*+]\s|\d+\.\s|\*\*[^*\n]{2,64}\*\*)/;

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

  // 上一块已结束于句读/冒号/换行，incoming 以块级 Markdown 结构开头 → 新段。
  // 必须锚定在 next 的**字符串开头**：曾用 `m` 标志，致 `^` 匹配任意行首，于是
  // "**\n- 开发者身份：…" 这类「首行是加粗收尾标记、次行才是列表」的 delta 被判成新段，
  // 在 `**当前会话状态：` / `**` 之间插入 `\n\n`，加粗标记被拆断渲染成裸 `**`。
  if (/[\n.!?。！？:：]$/.test(prev) && BLOCK_MARKDOWN_HEAD_RE.test(next)) {
    return true;
  }

  return false;
}
