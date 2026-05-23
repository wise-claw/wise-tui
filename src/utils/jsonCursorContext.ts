/** 计算光标前文本中 JSON 对象嵌套深度（忽略字符串内的括号）。 */
export function jsonBraceDepthBefore(text: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

/** 光标是否处于正在输入的属性名引号内（根对象 depth=1）。 */
export function isJsonRootPropertyKeyContext(textBeforeCursor: string): boolean {
  if (jsonBraceDepthBefore(textBeforeCursor) !== 1) {
    return false;
  }
  const trimmed = textBeforeCursor.trimEnd();
  if (!trimmed.endsWith('"') && !/"[^"]*$/.test(trimmed)) {
    return false;
  }
  const lastQuote = trimmed.lastIndexOf('"');
  if (lastQuote < 0) {
    return false;
  }
  const beforeQuote = trimmed.slice(0, lastQuote).trimEnd();
  return beforeQuote.endsWith("{") || beforeQuote.endsWith(",") || beforeQuote.length === 0;
}

/** 从光标前未闭合的属性名引号中提取已输入前缀。 */
export function partialJsonPropertyKeyPrefix(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/"([^"\\]*)$/);
  return match ? match[1] : null;
}
