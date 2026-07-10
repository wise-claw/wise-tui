import type { ClaudeMessage, MessagePart, ToolUsePart } from "../types";
import { joinAssistantTextPartBodies } from "./assistantTextParts";

const CLI_TOOL_NAMES = new Set(["bash", "exec", "run_command"]);

/** 助手 completion / 任务总结类 Markdown（含 ## 标题 + 中文总结语境或表格）。 */
export function looksLikeStructuredMarkdownSummary(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!/#{1,6}\s/m.test(t)) return false;
  if (/已完成|改动总结|以下是总结|全部改动|改动已就绪|零错误/.test(t)) return true;
  if (/总结|功能\s*[—\-–]|改动/.test(t)) return true;
  if (/\|.+\|.+\|/m.test(t)) return true;
  return false;
}

/** @deprecated 使用 {@link looksLikeStructuredMarkdownSummary} */
export function looksLikeAssistantCompletionSummary(text: string): boolean {
  return looksLikeStructuredMarkdownSummary(text);
}

/** 主会话中长段 Markdown（含 ## 标题、**小节**、多段列表等），用于增强排版与卡片容器。 */
export function looksLikeLongFormChatMarkdown(
  text: string,
  isSummary?: boolean,
  streamingShortOk?: boolean,
): boolean {
  // 允许调用方复用已计算的 isSummary，避免 chatAssistantTextPartClassNames 内重复跑 4 正则。
  const summary = isSummary ?? looksLikeStructuredMarkdownSummary(text);
  if (summary) return true;

  const t = text.trim();
  if (!t) return false;

  const markdownHeadings = (t.match(/^#{1,6}\s+/gm) ?? []).length;
  const boldSectionHeaders = (t.match(/^\*\*[^*\n]{2,64}\*\*\s*$/gm) ?? []).length;
  // 计数必须把无序列表（-/* /+）和有序列表（1. / 2. …）都算进去——历史上只统计无序列表，
  // 致 "1. 打开 IDE\n2. 选择菜单\n3. 点击按钮\n\n…后段说明" 这类典型"多说明点"形态不挂 chat-prose，
  // 流式态段间距 0.45em 与磁盘态 0.65em 视觉差距大，被用户感知为「最后几段集中到一起」。
  const unorderedListItems = (t.match(/^[\s]*[-*+]\s+/gm) ?? []).length;
  const orderedListItems = (t.match(/^\s*\d+\.\s+/gm) ?? []).length;
  const listItems = unorderedListItems + orderedListItems;
  const paragraphs = t.split(/\n\s*\n/).filter((block) => block.trim()).length;

  if ((markdownHeadings >= 1 || boldSectionHeaders >= 2) && listItems >= 2) return true;
  if (boldSectionHeaders >= 2 && paragraphs >= 3) return true;
  if (paragraphs >= 5) return true;
  if (listItems >= 5) return true;
  // 短"多说明点"形态：≥3 个列表项 + ≥2 段（说明 + 总结），典型如「1./2./3. 步骤 + 末尾总结」。
  // 旧实现因只数无序列表 + 段间 ≥5 双重落空，致这一形态始终回退到 0.45em 段间距。
  if (listItems >= 3 && paragraphs >= 2) return true;
  // 流式期早触发：text 累计 < 720 字时按上述规则几乎全 false，挂不上 chat-prose → 段间距 4px，
  // 与磁盘 JSONL 一次性加载整段命中 chat-prose 后的 0.65em 段间距差 4×，被用户感知为「最后几段集中到一起」。
  // 仅当流式期（streamingShortOk=true）且已出现 ≥2 段（含说明 + 末尾总结）时才早挂 long-prose 卡片，
  // 单段短回复（"好的，我来处理。" / "1. 步骤一\n2. 步骤二"）不会因新分支误挂卡片。
  // 磁盘态调用方不传 streamingShortOk → 此分支永不命中，行为字节级等价。
  if (streamingShortOk === true && paragraphs >= 2) return true;
  return t.length >= 720;
}

export function chatAssistantTextPartClassNames(
  text: string,
  streaming?: boolean,
): {
  partClassName: string;
  markdownClassName?: string;
} {
  const isSummary = looksLikeStructuredMarkdownSummary(text);
  const isLongProse = looksLikeLongFormChatMarkdown(text, isSummary, streaming);
  let partClassName = "app-message-part app-message-part--text";
  if (isSummary) {
    partClassName += " app-message-part--completion-summary";
  } else if (isLongProse) {
    partClassName += " app-message-part--long-prose";
  }
  return {
    partClassName,
    markdownClassName: isLongProse ? "app-markdown--chat-prose" : undefined,
  };
}

/** Bash/Exec 输出尾部若附带总结 Markdown，拆成 CLI 前缀 + 总结正文。 */
export function splitCliOutputAndMarkdownSummary(text: string): { cli: string; markdown: string } | null {
  const raw = text.trim();
  if (!raw || !/#{1,6}\s/m.test(raw)) return null;

  const introSplit = raw.match(/\n(?=(?:零错误|全部改动|以下是总结|已完成|改动总结))/);
  if (introSplit && introSplit.index != null && introSplit.index > 0) {
    const cli = raw.slice(0, introSplit.index).trimEnd();
    const markdown = raw.slice(introSplit.index).trimStart();
    if (cli && looksLikeStructuredMarkdownSummary(markdown)) {
      return { cli, markdown };
    }
  }

  const headingSplit = raw.match(/\n\n(?=#{1,6}\s)/);
  if (headingSplit && headingSplit.index != null && headingSplit.index > 0) {
    const cli = raw.slice(0, headingSplit.index).trimEnd();
    const markdown = raw.slice(headingSplit.index).trimStart();
    if (cli && looksLikeStructuredMarkdownSummary(markdown)) {
      return { cli, markdown };
    }
  }

  return null;
}

/** 最后一个 tool_use 之后的 text 段落（不含工具前的分析/引导语）。 */
export function assistantMessagePostToolTextParts(parts: MessagePart[]): string {
  let lastToolIdx = -1;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]?.type === "tool_use") lastToolIdx = i;
  }
  const texts: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p?.type === "text" && i > lastToolIdx) {
      const t = p.text.trim();
      if (t) texts.push(t);
    }
  }
  return joinAssistantTextPartBodies(texts);
}

function isCliToolPart(part: ToolUsePart): boolean {
  return CLI_TOOL_NAMES.has(part.name.trim().toLowerCase());
}

/** 从 Bash/Exec 工具 output 中提取应独立展示的 Markdown 总结。 */
export function extractBashEmbeddedMarkdownSummary(parts: MessagePart[]): string {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (p?.type !== "tool_use" || !isCliToolPart(p)) continue;
    const output = p.output?.trim() ?? "";
    if (!output) continue;
    const split = splitCliOutputAndMarkdownSummary(output);
    if (split?.markdown) return split.markdown;
    if (looksLikeStructuredMarkdownSummary(output)) return output;
    return "";
  }
  return "";
}

/** Bash/Exec 展开区仅保留 CLI stdout（总结提升到工具块外 Markdown 展示）。 */
export function cliToolOutputForExpandedBody(part: ToolUsePart): string {
  const output = part.output?.trim() ?? "";
  if (!output || !isCliToolPart(part)) return output;
  const split = splitCliOutputAndMarkdownSummary(output);
  if (split?.cli) return split.cli;
  if (looksLikeStructuredMarkdownSummary(output)) return "";
  return output;
}

/**
 * `parts` 未覆盖、仅落在 `content` 上的助手 Markdown 正文（常见于 result 与 tool 同批或落盘不同步）。
 *
 * Partial 守卫：当 parts 没有任何 text part 时，content 通常是磁盘快照的整段完整正文，
 * 而 parts 还在加载中（流式中段 / 分批磁盘加载）。此时**不能**把 content 整段当作 orphan
 * 渲染，否则 partial 文本会被当成最终总结展示，触发「获取部分消息就当文本」的污染。
 *
 * 仅当 parts **至少有一条 text part**（说明 parts 已经开始加载），且与 content 长度
 * 不一致时，才把 content 末尾多出来的段落拆作 orphan。
 */
export function assistantOrphanMarkdownText(msg: ClaudeMessage): string {
  if (msg.role !== "assistant") return "";
  const parts = msg.parts ?? [];

  const postToolText = assistantMessagePostToolTextParts(parts);
  if (postToolText && looksLikeStructuredMarkdownSummary(postToolText)) {
    return "";
  }

  const fromBash = extractBashEmbeddedMarkdownSummary(parts);
  if (fromBash) return fromBash;

  const content = (msg.content ?? "").trim();
  if (!content) return "";
  const partTexts = parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text.trim())
    .filter(Boolean);
  // Partial 守卫：parts 还没有任何 text part 时（典型 partial 状态），不拆 orphan，
  // 避免把磁盘快照的整段 content 提前渲染成"总结"。
  if (partTexts.length === 0) return "";
  const joinedParts = partTexts.join("\n\n").trim();
  if (!joinedParts) return content;
  if (content === joinedParts) return "";
  if (content.startsWith(joinedParts)) {
    return content.slice(joinedParts.length).trim();
  }
  return "";
}
