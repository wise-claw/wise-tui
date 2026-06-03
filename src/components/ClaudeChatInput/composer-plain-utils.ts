import type { Content } from "@douyinfe/semi-ui/lib/es/aiChatInput/interface";
import type { Prompt } from "../../types";
import { serializePromptPartsToClaudeString } from "../../utils/serializeClaudePrompt";
import type { TriggerInfo } from "./slash-trigger";

export function contentsToPlain(contents: Content[]): string {
  let out = "";
  for (const c of contents) {
    if (c.type === "text") {
      const text = (c as unknown as { text?: string }).text;
      if (typeof text === "string") out += text;
    }
  }
  return out;
}

/** 将 composer Prompt 转为与 Tiptap 对齐的纯文本（不 trimEnd，避免多行/行尾换行与编辑器不一致）。 */
export function promptToDisplayPlain(prompt: Prompt): string {
  return serializePromptPartsToClaudeString(prompt, { trimEnd: false });
}

export function singleTextPrompt(plain: string): Prompt {
  const t = plain;
  return [{ type: "text", text: t, start: 0, end: t.length }];
}

function currentLineBeforeCursor(text: string, cursor: number): string {
  const beforeCursor = text.substring(0, cursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  return beforeCursor.substring(lineStart);
}

/** 行内 `/` 触发：允许「sds/」这类前缀，但排除 URL/path 里的 `://` 与 `//`。 */
function matchInlineSlashTrigger(currentLine: string): RegExpMatchArray | null {
  const lastBreak = Math.max(currentLine.lastIndexOf(" "), currentLine.lastIndexOf("\t"));
  const token = lastBreak >= 0 ? currentLine.slice(lastBreak + 1) : currentLine;
  if ((token.match(/\//g) ?? []).length !== 1) return null;

  const match = token.match(/\/(\S*)$/);
  if (!match) return null;

  const slashIndex = currentLine.length - match[0].length;
  if (slashIndex > 0 && currentLine[slashIndex - 1] === ":") return null;
  return match;
}

/** 行内 `@` 触发：光标前当前行以 `@query` 结尾即可（不要求行首）。 */
function matchInlineAtTrigger(currentLine: string): RegExpMatchArray | null {
  return currentLine.match(/@(\S*)$/);
}

export function detectAtSlashTrigger(
  plain: string,
  cursor: number,
): { mode: "at" | "slash"; query: string; triggerStart: number } | null {
  const text = plain.replace(/\u200B/g, "");
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const lineStart = text.lastIndexOf("\n", safeCursor - 1) + 1;
  const currentLine = text.substring(lineStart, safeCursor);

  const atMatch = matchInlineAtTrigger(currentLine);
  if (atMatch) {
    const tokenLen = atMatch[0].length;
    return {
      mode: "at",
      query: atMatch[1] ?? "",
      triggerStart: lineStart + currentLine.length - tokenLen,
    };
  }

  const slashMatch = matchInlineSlashTrigger(currentLine);
  if (slashMatch) {
    const lastBreak = Math.max(currentLine.lastIndexOf(" "), currentLine.lastIndexOf("\t"));
    const tokenStartOnLine = lastBreak >= 0 ? lastBreak + 1 : 0;
    const token = currentLine.slice(tokenStartOnLine);
    const slashIndexOnLine = tokenStartOnLine + token.length - slashMatch[0].length;
    return {
      mode: "slash",
      query: slashMatch[1] ?? "",
      triggerStart: lineStart + slashIndexOnLine,
    };
  }

  return null;
}

export function reportAtSlashTriggerFromPlain(
  plain: string,
  cursor: number,
  onTriggerChange: ((t: TriggerInfo) => void) | undefined,
  rect: DOMRect | null,
) {
  if (!onTriggerChange) return;
  const detected = detectAtSlashTrigger(plain, cursor);
  if (detected) {
    onTriggerChange({ mode: detected.mode, query: detected.query, rect });
  } else {
    onTriggerChange({ mode: null, query: "", rect: null });
  }
}

export function removeAtTriggerFromPlain(
  plain: string,
  cursor: number,
  query: string,
): { plain: string; cursor: number } {
  const token = `@${query}`;
  const end = Math.max(0, Math.min(cursor, plain.length));
  const start = end - token.length;
  if (start >= 0 && plain.slice(start, end) === token) {
    return { plain: plain.slice(0, start) + plain.slice(end), cursor: start };
  }
  const fb = plain.lastIndexOf(token);
  if (fb >= 0) {
    return { plain: plain.slice(0, fb) + plain.slice(fb + token.length), cursor: fb };
  }
  return { plain, cursor: end };
}

export function insertPlainAt(plain: string, cursor: number, insertion: string): { plain: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, plain.length));
  const next = plain.slice(0, c) + insertion + plain.slice(c);
  return { plain: next, cursor: c + insertion.length };
}

/**
 * @ 补全或拖入文件引用插入后：保证提及与后续输入之间至少有一个空格。
 * - 已在末尾且最后字符非空白 → 追加一个空格（避免富文本编辑器吞掉尾随空格）
 * - 光标在中间且前后都是非空白 → 在光标处插入一个空格
 */
export function ensureSpaceAfterAtInsert(plain: string, cursor: number): { plain: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, plain.length));
  if (c < plain.length) {
    const nextCh = plain[c]!;
    if (/\S/.test(nextCh)) {
      const prevCh = c > 0 ? plain[c - 1]! : "";
      if (prevCh && /\S/.test(prevCh)) {
        return insertPlainAt(plain, c, " ");
      }
    }
    return { plain, cursor: c };
  }
  if (plain.length > 0) {
    const last = plain[plain.length - 1]!;
    if (/\S/.test(last)) {
      const p = `${plain} `;
      return { plain: p, cursor: p.length };
    }
  }
  return { plain, cursor: c };
}

export function replaceSlashCommandLine(
  plain: string,
  cursor: number,
  commandLabel: string,
): { plain: string; cursor: number } {
  const before = plain.slice(0, Math.min(cursor, plain.length));
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineText = before.slice(lineStart);
  const m = matchInlineSlashTrigger(lineText);
  if (!m) return { plain, cursor: Math.min(cursor, plain.length) };

  const lastBreak = Math.max(lineText.lastIndexOf(" "), lineText.lastIndexOf("\t"));
  const tokenStartOnLine = lastBreak >= 0 ? lastBreak + 1 : 0;
  const token = lineText.slice(tokenStartOnLine);
  const slashIndexOnLine = tokenStartOnLine + token.length - m[0].length;
  const slashStart = lineStart + slashIndexOnLine;
  const insertion = `/${commandLabel} `;
  const next = plain.slice(0, slashStart) + insertion + plain.slice(before.length);
  return { plain: next, cursor: slashStart + insertion.length };
}
