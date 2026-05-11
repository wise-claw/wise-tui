import { useMemo } from "react";
import { Markdown } from "./Markdown";
import { formatJsonPrettyRoot, JsonSyntaxHighlight } from "./systemMessageJson";

function isErrorNotice(text: string): boolean {
  const head = text.trimStart().slice(0, 32);
  return /^错误[:：]|^发送失败[:：]|^启动失败[:：]/.test(head);
}

/** 收集若干候选串，依次尝试 JSON.parse（含 ```json 围栏、正文前缀后的 JSON） */
function collectJsonCandidates(raw: string): string[] {
  const t = raw.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  const fence = t.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) push(fence[1]!);

  push(t);

  const braceIdx = t.search(/[\[{]/);
  if (braceIdx > 0 && braceIdx < 8000) {
    push(t.slice(braceIdx));
  }

  return out;
}

function tryParseJsonValue(raw: string): unknown | null {
  for (const c of collectJsonCandidates(raw)) {
    try {
      return JSON.parse(c);
    } catch {
      continue;
    }
  }
  return null;
}

/** 去掉 BOM、统一换行，减少解析与展示异常 */
function normalizeSystemText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
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

export function SystemMessageContent({ text }: { text: string }) {
  const normalizedText = useMemo(() => normalizeSystemText(text), [text]);
  const trimmed = normalizedText.trim();
  if (!trimmed) return null;

  const parsedJson = useMemo(() => tryParseJsonValue(normalizedText), [normalizedText]);
  const isJson = parsedJson !== null;
  const formattedJson = useMemo(() => {
    if (parsedJson === null) return "";
    return formatJsonPrettyRoot(parsedJson);
  }, [parsedJson]);

  const error = isErrorNotice(normalizedText);

  return (
    <div className={`app-system-message${error ? " app-system-message--error" : ""}`}>
      <div className="app-system-message-body">
        {isJson ? (
          <div className="app-system-message-json-wrap">
            <pre className="app-system-message-json-pre">
              <code className="app-system-message-json-code">
                <JsonSyntaxHighlight text={formattedJson} />
              </code>
            </pre>
          </div>
        ) : (
          <Markdown
            text={hardenMarkdownOutsideCodeFences(normalizedText)}
            streaming={false}
            showPendingHint={false}
            className="app-system-message-md"
          />
        )}
      </div>
    </div>
  );
}
