import type { ReactNode } from "react";

/** 带缩进的 stringify，循环引用记为 [Circular] */
export function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === "object" && v !== null) {
          const o = v as object;
          if (seen.has(o)) return "[Circular]";
          seen.add(o);
        }
        return v;
      },
      2,
    );
  } catch {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

/**
 * 根为「内含 JSON 的字符串」时展开为缩进对象；否则标准 stringify。
 */
export function formatJsonPrettyRoot(parsed: unknown): string {
  if (typeof parsed === "string") {
    const t = parsed.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length >= 2) {
      try {
        return safeJsonStringify(JSON.parse(t));
      } catch {
        /* 非合法 JSON 字符串，退回普通字符串展示 */
      }
    }
    return JSON.stringify(parsed, null, 2);
  }
  return safeJsonStringify(parsed);
}

function isWs(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}

/** 对已格式化的 JSON 文本做轻量语法着色（React 节点，无 dangerouslySetInnerHTML） */
export function JsonSyntaxHighlight({ text }: { text: string }): ReactNode {
  const nodes: ReactNode[] = [];
  let i = 0;
  const s = text;
  const n = s.length;
  let elKey = 0;
  const span = (cls: string, content: string) => (
    <span key={`j-${elKey++}`} className={cls}>
      {content}
    </span>
  );

  while (i < n) {
    const c = s[i];
    if (isWs(c)) {
      let j = i + 1;
      while (j < n && isWs(s[j]!)) j++;
      nodes.push(s.slice(i, j));
      i = j;
      continue;
    }
    if ("{}[],:".includes(c)) {
      nodes.push(span("app-json__punct", c));
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        const ch = s[i]!;
        if (ch === "\\" && i + 1 < n) {
          const nxt = s[i + 1]!;
          if (nxt === "u" && i + 5 < n) {
            const hex = s.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              i += 6;
              continue;
            }
          }
          i += 2;
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
        const cp = s.codePointAt(i)!;
        i += cp > 0xffff ? 2 : 1;
      }
      const slice = s.slice(start, i);
      let k = i;
      while (k < n && isWs(s[k]!)) k++;
      const isKey = s[k] === ":";
      nodes.push(span(isKey ? "app-json__key" : "app-json__str", slice));
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[-+eE0-9.]/.test(s[j]!)) j++;
      nodes.push(span("app-json__num", s.slice(i, j)));
      i = j;
      continue;
    }
    if (s.startsWith("true", i)) {
      nodes.push(span("app-json__kw", "true"));
      i += 4;
      continue;
    }
    if (s.startsWith("false", i)) {
      nodes.push(span("app-json__kw", "false"));
      i += 5;
      continue;
    }
    if (s.startsWith("null", i)) {
      nodes.push(span("app-json__kw", "null"));
      i += 4;
      continue;
    }
    const cp = s.codePointAt(i)!;
    const w = cp > 0xffff ? 2 : 1;
    nodes.push(span("app-json__misc", s.slice(i, i + w)));
    i += w;
  }

  return <>{nodes}</>;
}
