import type { ContentPart, ContextItem, Prompt } from "../types";

/** 与编辑器逻辑长度一致：药丸计 1 字符，供光标 / 历史导航使用 */
export function promptToLogicalPlainString(parts: Prompt): string {
  return parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "file" || p.type === "agent" || p.type === "team") return "\uFFFC";
      return "";
    })
    .join("");
}

export interface SerializePromptPartsOptions {
  /**
   * 默认 true：去掉文末空白（发往 CLI 时更干净）。
   * 设为 false 时保留末尾换行/空格，与 Tiptap 纯文本逐字一致，避免 composer 里误触发 setContent 回写把多行压成一行。
   */
  trimEnd?: boolean;
}

/**
 * 将 composer 中的段落序列化为发给 `claude -p` 的纯文本：
 * - 保留普通文本与换行（含 `/command`）
 * - `file` / `agent` 转为 `@path`、`@name`，并在与前一段无空白时补空格
 */
export function serializePromptPartsToClaudeString(
  parts: ContentPart[],
  opts: SerializePromptPartsOptions = {},
): string {
  let out = "";
  for (const p of parts) {
    if (p.type === "text") {
      out += p.text;
    } else if (p.type === "file") {
      const path = (p.path ?? "").trim();
      if (!path) continue;
      const mention = path.startsWith("@") ? path : `@${path}`;
      if (out.length > 0 && !/\s$/.test(out)) out += " ";
      out += mention;
    } else if (p.type === "agent") {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      const mention = name.startsWith("@") ? name : `@${name}`;
      if (out.length > 0 && !/\s$/.test(out)) out += " ";
      out += mention;
    } else if (p.type === "team") {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      const mention = name.startsWith("@") ? name : `@${name}`;
      if (out.length > 0 && !/\s$/.test(out)) out += " ";
      out += mention;
    }
  }
  const cleaned = out.replace(/\u200B/g, "");
  if (opts.trimEnd === false) return cleaned;
  return cleaned.trimEnd();
}

/** 将仅出现在「上下文条」中的文件补成 @ 引用（去重、避免重复 @） */
export function mergeContextFileMentions(body: string, contextItems: ContextItem[]): string {
  const mentioned = new Set<string>();
  for (const m of body.matchAll(/@([^\s@]+)/g)) {
    mentioned.add(m[1]!);
  }
  let out = body.trimEnd();
  for (const item of contextItems) {
    if (item.type !== "file") continue;
    const p = item.path.trim();
    if (!p || mentioned.has(p)) continue;
    mentioned.add(p);
    const mention = p.startsWith("@") ? p : `@${p}`;
    if (out.length > 0 && !/\s$/.test(out)) out += " ";
    out += mention;
  }
  return out.trim();
}
