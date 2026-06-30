import { useMemo } from "react";
import { Markdown } from "./Markdown";

function isErrorNotice(text: string): boolean {
  const head = text.trimStart().slice(0, 32);
  return /^错误[:：]|^发送失败[:：]|^启动失败[:：]/.test(head);
}

/** 去掉 BOM、统一换行，减少解析与展示异常 */
function normalizeSystemText(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

/**
 * 在 ``` 围栏外把易被 marked 当成 HTML 的 `<` 写成 `\\<`，避免 DOMPurify 后乱码或吞字。
 * 不影响围栏内内容（多为 JSON/代码）。
 */
function hardenMarkdownOutsideCodeFences(md: string): string {
  const chunks = md.split(/(```[\s\S]*?```)/g);
  return chunks
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk;
      return chunk.replace(/<(?!(?:https?:\/\/|mailto:))(?=[a-zA-Z/!?])/gi, "\\<");
    })
    .join("");
}

/**
 * 系统消息裸展示：不再套用外层卡片 / 工具栏，仅保留一个轻量状态 className，
 * 用于在消息气泡上做错误着色。复制 / 展开 / 格式徽标等装饰交给消息行操作菜单。
 */
export function SystemMessageContent({ text }: { text: string }) {
  const normalizedText = useMemo(() => normalizeSystemText(text), [text]);
  const error = isErrorNotice(normalizedText);
  const trimmed = normalizedText.trim();
  if (!trimmed) return null;

  return (
    <div className={`app-system-message${error ? " app-system-message--error" : ""}`}>
      <Markdown
        text={hardenMarkdownOutsideCodeFences(normalizedText)}
        streaming={false}
        showPendingHint={false}
        className="app-system-message-md"
      />
    </div>
  );
}