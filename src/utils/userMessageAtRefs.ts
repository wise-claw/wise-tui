/**
 * 用户消息里的 `@` 引用（文件 / 目录 / 智能体）切分。
 *
 * 会话气泡与 Composer 保持一致：Composer 用 `findComposerHighlightRanges` 把 `@…` 高亮成
 * 引用 token，用户气泡此前只做纯文本渲染，`@路径` 混在正文里完全看不出是引用。这里提供
 * 一个只做展示切分的纯函数，不改动正文内容（用户消息仍按纯文本渲染，不走 Markdown）。
 *
 * 规则（对照 Codex 桌面端）：
 * - `@` 必须位于行首或空白 / 起始标点之后，避免把 `mailto:a@b.com`、`https://x/@y` 当成引用；
 * - 引用体到空白或句读标点为止，尾部句读（`，。`、`.`、`)` 等）不计入引用；
 * - `@` 后必须至少有一个有效字符，否则按普通文本处理。
 */

export type UserMessageAtRefToken =
  | { type: "text"; value: string }
  | { type: "at"; value: string };

/** 全角 / 半角 `@`。 */
const AT_SIGNS = new Set(["@", "＠"]);

/** 出现在 `@` 之前仍视为引用起点的字符（起始括号 / 引号 / 常见分隔符）。 */
const REF_LEAD_BOUNDARY_CHARS = new Set([
  "，", "。", "、", "；", "：", "！", "？", "（", "）", "【", "】", "《", "》",
  "“", "”", "‘", "’", "…", "—",
  ",", ";", ":", "!", "?", "(", ")", "[", "]", "{", "}", "<", ">", "\"", "'", "`",
  "-", "*", ">",
]);

/** 终止引用体的字符：空白之外的句读 / 括注。 */
const REF_STOP_CHARS = new Set([
  "，", "。", "、", "；", "：", "！", "？", "（", "）", "【", "】", "《", "》",
  "“", "”", "‘", "’", "…", "—",
  ",", ";", "!", "?", "(", ")", "[", "]", "{", "}", "<", ">", "\"", "'", "`",
]);

/** 引用体尾部可安全丢弃的句读（句号、右括号等）。 */
const REF_TRAILING_TRIM_CHARS = new Set([
  ".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "\"", "'", "`",
  "，", "。", "、", "；", "：", "！", "？", "）", "】", "》", "”", "’", "…",
]);

function isAtBoundary(text: string, atIndex: number): boolean {
  if (atIndex === 0) return true;
  const prev = text[atIndex - 1]!;
  if (/\s/u.test(prev)) return true;
  return REF_LEAD_BOUNDARY_CHARS.has(prev);
}

function readAtRef(text: string, atIndex: number): { value: string; end: number } | null {
  let end = atIndex + 1;
  while (end < text.length) {
    const ch = text[end]!;
    if (/\s/u.test(ch) || REF_STOP_CHARS.has(ch)) break;
    end += 1;
  }
  while (end > atIndex + 1 && REF_TRAILING_TRIM_CHARS.has(text[end - 1]!)) end -= 1;
  if (end <= atIndex + 1) return null;
  return { value: text.slice(atIndex, end), end };
}

/** 把消息正文切成「普通文本 / @引用」token 序列；无引用时返回单个 text token。 */
export function splitUserMessageAtRefs(text: string): UserMessageAtRefToken[] {
  if (!text) return [];
  const tokens: UserMessageAtRefToken[] = [];
  let cursor = 0;
  let index = 0;

  while (index < text.length) {
    if (!AT_SIGNS.has(text[index]!)) {
      index += 1;
      continue;
    }
    if (!isAtBoundary(text, index)) {
      index += 1;
      continue;
    }
    const ref = readAtRef(text, index);
    if (!ref) {
      index += 1;
      continue;
    }
    if (index > cursor) tokens.push({ type: "text", value: text.slice(cursor, index) });
    tokens.push({ type: "at", value: ref.value });
    cursor = ref.end;
    index = ref.end;
  }

  if (cursor < text.length) tokens.push({ type: "text", value: text.slice(cursor) });
  return tokens;
}
