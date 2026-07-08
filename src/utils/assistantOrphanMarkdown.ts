import type { ClaudeMessage, MessagePart, ToolUsePart } from "../types";

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
export function looksLikeLongFormChatMarkdown(text: string, isSummary?: boolean): boolean {
  // 允许调用方复用已计算的 isSummary，避免 chatAssistantTextPartClassNames 内重复跑 4 正则。
  const summary = isSummary ?? looksLikeStructuredMarkdownSummary(text);
  if (summary) return true;

  const t = text.trim();
  if (!t) return false;

  const markdownHeadings = (t.match(/^#{1,6}\s+/gm) ?? []).length;
  const boldSectionHeaders = (t.match(/^\*\*[^*\n]{2,64}\*\*\s*$/gm) ?? []).length;
  const listItems = (t.match(/^[\s]*[-*+]\s+/gm) ?? []).length;
  const paragraphs = t.split(/\n\s*\n/).filter((block) => block.trim()).length;

  if ((markdownHeadings >= 1 || boldSectionHeaders >= 2) && listItems >= 2) return true;
  if (boldSectionHeaders >= 2 && paragraphs >= 3) return true;
  if (paragraphs >= 5) return true;
  if (listItems >= 5) return true;
  return t.length >= 720;
}

export function chatAssistantTextPartClassNames(text: string): {
  partClassName: string;
  markdownClassName?: string;
} {
  const isSummary = looksLikeStructuredMarkdownSummary(text);
  const isLongProse = looksLikeLongFormChatMarkdown(text, isSummary);
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
  return texts.join("\n\n").trim();
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

/** `parts` 未覆盖、仅落在 `content` 上的助手 Markdown 正文（常见于 result 与 tool 同批或落盘不同步）。 */
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
  const joinedParts = partTexts.join("\n\n").trim();
  if (!joinedParts) return content;
  if (content === joinedParts) return "";
  if (content.startsWith(joinedParts)) {
    return content.slice(joinedParts.length).trim();
  }
  return "";
}
