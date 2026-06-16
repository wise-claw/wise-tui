import { marked } from "marked";
import DOMPurify, { type Config } from "dompurify";
import { isValidHttpUrl, normalizeAutolinkUrl } from "./autolinkUrl";
import { normalizeMarkdownForDisplay, normalizeMarkdownLineBreaks } from "./markdownDisplayNormalize";
import {
  shouldRenderFencedBlockAsMermaid,
  wrapMermaidBlocksInMarkdown,
} from "./mermaidBlock";

marked.use({ gfm: true, breaks: true });

const MARKED_OPTIONS = { async: false as const, breaks: true, gfm: true };
const DOMPURIFY_OPTIONS: Config = {
  USE_PROFILES: { html: true, mathMl: true },
  FORBID_TAGS: ["style", "script"],
};

const DISPLAY_HTML_CACHE_MAX = 128;
const displayHtmlCache = new Map<string, string>();

export function coerceMarkdownSourceText(input: unknown): string {
  if (input == null) return "";
  let text = "";
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = String(input);
    } catch {
      return "";
    }
  }
  return normalizeMarkdownLineBreaks(text);
}

/** 聊天展示前规范化 Markdown 源码（不转 HTML）。 */
export function prepareMarkdownForDisplay(text: string, opts?: { streaming?: boolean }): string {
  const source = coerceMarkdownSourceText(text);
  if (!source.trim()) return "";
  const stabilized = opts?.streaming ? stabilizeStreamingMarkdown(source) : source;
  const unwrapped = unwrapProseFencedMarkdownSource(stabilized);
  const wrappedMermaid = wrapMermaidBlocksInMarkdown(unwrapped);
  return normalizeMarkdownForDisplay(wrappedMermaid, { streaming: opts?.streaming });
}

function escapeHtmlPlain(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tryDecodeUriForDisplay(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

const PROSE_FENCE_LANGS = new Set([
  "",
  "markdown",
  "md",
  "mdx",
  "text",
  "plaintext",
  "txt",
  "prose",
  "document",
  "doc",
]);

/** 围栏 info 字符串是否应视为「正文 Markdown」而非编程语言。 */
export function isProseFenceLanguage(lang: string): boolean {
  const l = lang.trim().toLowerCase();
  if (PROSE_FENCE_LANGS.has(l)) return true;
  // 模型把 Markdown 语法泄漏进 info（如 ```**5**）
  if (/[*#|[\](){}]/.test(l)) return true;
  if (!/^[a-z][a-z0-9_+#.-]*$/i.test(l)) return true;
  return false;
}

/** 文本是否含应走 Markdown 渲染的结构（表格、标题、列表等）。 */
export function hasMarkdownStructureCues(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(?:#+\s|[-*+]\s|\d+\.\s)/m.test(t)) return true;
  if (/^-\s\[[ xX]\]\s/m.test(t)) return true;
  if (/^(?:---|___|\*\*\*)$/m.test(t)) return true;
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(t)) return true;
  if (/^\|.+\|.+\|/m.test(t)) return true;
  if (/^>\s/m.test(t)) return true;
  return false;
}

function isLikelyJsonLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (!/^[\[{]/.test(t)) return false;
  if (!/[\]}]\s*[,;]?$/.test(t)) return false;
  return true;
}

function looksLikeNdjsonBlock(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const jsonLines = lines.filter(isLikelyJsonLine).length;
  return jsonLines >= Math.max(1, Math.ceil(lines.length * 0.75));
}

function looksLikeShellOrSourceCode(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeNdjsonBlock(t)) return true;
  const lines = t.split("\n");
  const codeish = lines.filter((line) =>
    /^\s*(?:\$|>|#!\/|import\s+|export\s+|const\s+|let\s+|var\s+|function\s+|def\s+|class\s+|curl\s+|npm\s+|git\s+|sudo\s+|SELECT\s+)/.test(
      line,
    ),
  ).length;
  if (codeish >= 2) return true;
  if (/^\{[\s\S]*\}$/.test(t) || /^\[[\s\S]*\]$/.test(t)) return true;
  return false;
}

const DATA_FENCE_LANGS =
  /^(?:json|jsonc|json5|yaml|yml|toml|xml|csv|output|result|log|console|stderr|stdout|response)$/;

const CODE_FENCE_LANGS_WITH_LINE_COMMENTS =
  /^(?:bash|sh|shell|zsh|fish|python|py|ruby|rb|perl|pl|javascript|js|typescript|ts|jsx|tsx|go|rust|rs|java|kotlin|swift|c|cpp|csharp|cs)$/;

function hasMarkdownBlockSignals(body: string): boolean {
  const hasBlockList = /^[-*+]\s/m.test(body) || /^\d+\.\s/m.test(body);
  const hasCheckboxList = /^-\s\[[ xX]\]\s/m.test(body);
  const hasBlockTable = /^\|.+\|.+\|/m.test(body);
  const hasBlockQuote = /^>\s/m.test(body);
  const hasHorizontalRule = /^(?:---|___|\*\*\*)$/m.test(body);
  const hasH1 = /^#\s/m.test(body);
  const hasDeepHeading = /^#{2,6}\s/m.test(body);
  return (
    hasBlockList ||
    hasCheckboxList ||
    hasBlockTable ||
    hasBlockQuote ||
    hasHorizontalRule ||
    hasDeepHeading ||
    hasH1
  );
}

/** 代码类围栏 info，但正文实为 Markdown（模型误标 json/bash 等）。 */
function looksLikeMislabeledMarkdownFence(body: string, lang: string): boolean {
  const l = lang.trim().toLowerCase();
  if (!l || isProseFenceLanguage(l)) return false;
  if (looksLikeShellOrSourceCode(body)) return false;
  if (!hasMarkdownBlockSignals(body)) return false;

  if (DATA_FENCE_LANGS.test(l)) return true;

  if (CODE_FENCE_LANGS_WITH_LINE_COMMENTS.test(l)) {
    // 单行 # 在 shell/python 中多为注释；## 及以上更可能是 Markdown 标题
    return (
      /^[-*+]\s/m.test(body) ||
      /^\d+\.\s/m.test(body) ||
      /^-\s\[[ xX]\]\s/m.test(body) ||
      /^\|.+\|.+\|/m.test(body) ||
      /^>\s/m.test(body) ||
      /^#{2,6}\s/m.test(body)
    );
  }

  return true;
}

/** 误标围栏内「Markdown 正文 + 尾部 NDJSON/日志行」拆分；无可拆分时返回 null。 */
export function splitMarkdownAndTrailingDataLines(body: string): {
  markdown: string;
  dataLines: string;
} | null {
  const lines = body.split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !lines[end]!.trim()) end -= 1;
  if (end < 0) return null;

  const dataChunk: string[] = [];
  let i = end;
  while (i >= 0) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed) {
      if (dataChunk.length > 0) break;
      i -= 1;
      continue;
    }
    if (!isLikelyJsonLine(raw)) break;
    dataChunk.unshift(raw);
    i -= 1;
  }
  if (dataChunk.length === 0) return null;

  const markdown = lines.slice(0, i + 1).join("\n").trim();
  if (!markdown || !hasMarkdownStructureCues(markdown)) return null;

  return { markdown, dataLines: dataChunk.join("\n") };
}

export type FencedBlockDisplayPlan =
  | { kind: "mermaid"; text: string }
  | { kind: "code"; text: string; lang: string }
  | { kind: "markdown"; text: string }
  | { kind: "markdown-plus-data"; markdown: string; dataLines: string; lang: string };

/** 统一规划围栏块应渲染为 Mermaid / Markdown / 代码 / 混合。 */
export function planFencedBlockDisplay(text: string, lang: string): FencedBlockDisplayPlan {
  const body = text.replace(/\n$/, "");
  const normalizedLang = lang.trim().toLowerCase();

  if (shouldRenderFencedBlockAsMermaid(body, normalizedLang)) {
    return { kind: "mermaid", text: body };
  }

  const split = splitMarkdownAndTrailingDataLines(body);
  if (split && shouldRenderFencedBlockAsMarkdown(split.markdown, normalizedLang)) {
    return {
      kind: "markdown-plus-data",
      markdown: split.markdown,
      dataLines: split.dataLines,
      lang: normalizedLang,
    };
  }

  if (shouldRenderFencedBlockAsMarkdown(body, normalizedLang)) {
    return { kind: "markdown", text: body };
  }

  return { kind: "code", text: body, lang: normalizedLang };
}

/** 围栏 code block 是否应解析为 Markdown 正文而非等宽代码。 */
export function shouldRenderFencedBlockAsMarkdown(codeText: string, lang: string): boolean {
  const body = codeText.trim();
  if (!body || !hasMarkdownStructureCues(body)) return false;
  if (isProseFenceLanguage(lang)) {
    return !looksLikeShellOrSourceCode(body);
  }
  // 真实语言标签但正文明显是文档（含表格 + 标题）
  if (/^\|.+\|.+\|/m.test(body) && /#{1,6}\s/m.test(body)) return true;
  if (/^\|.+\|.+\|/m.test(body) && /\*\*[^*]+\*\*/.test(body)) return true;
  if (looksLikeMislabeledMarkdownFence(body, lang)) return true;
  return false;
}

/** 整段被单个 prose 围栏包裹时，剥掉围栏再交给 marked。 */
export function unwrapProseFencedMarkdownSource(text: string): string {
  const trimmed = text.trim();
  const match = /^```([^\n`]*)\n([\s\S]*?)\n?```$/u.exec(trimmed);
  if (!match) return text;
  const lang = match[1]?.trim() ?? "";
  const body = match[2] ?? "";
  if (shouldRenderFencedBlockAsMarkdown(body, lang)) {
    return body.trim();
  }
  return text;
}

function extractCodeBlockLanguage(code: Element | null): string {
  if (!code) return "";
  const cls = code.getAttribute("class") ?? "";
  const m = /\blanguage-([^\s]+)/.exec(cls);
  return m?.[1]?.trim() ?? "";
}

const ENHANCE_RECURSE_MAX_DEPTH = 4;

/** 流式输出中补全未闭合围栏，避免 marked 把后续正文吞进 code block。 */
export function stabilizeStreamingMarkdown(text: string): string {
  const source = text.trimEnd();
  if (!source) return source;

  let stabilized = source;
  const fenceCount = (stabilized.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    stabilized += "\n```";
  }

  // 单行内联代码若奇数个反引号，补一个闭合（避免破坏段落解析）。
  const lines = stabilized.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine && !lastLine.trimStart().startsWith("```")) {
    const inlineTicks = (lastLine.match(/(?<!`)`(?!`)/g) ?? []).length;
    if (inlineTicks % 2 === 1) {
      stabilized += "`";
    }
  }

  return stabilized;
}

function sanitizeMarkdownHtml(html: string): string {
  if (!html) return "";
  try {
    if (typeof DOMPurify?.sanitize === "function") {
      return DOMPurify.sanitize(html, DOMPURIFY_OPTIONS);
    }
  } catch {
    /* fall through */
  }
  return html;
}

function parseMarkedHtml(normalized: string, fallbackSource: string): string {
  try {
    const parsed = marked.parse(normalized, MARKED_OPTIONS);
    if (typeof parsed !== "string") {
      return escapeHtmlPlain(fallbackSource).replace(/\n/g, "<br>");
    }
    if (parsed.trim()) {
      return sanitizeMarkdownHtml(parsed);
    }
  } catch {
    /* fall through */
  }
  return escapeHtmlPlain(fallbackSource).replace(/\n/g, "<br>");
}

/** marked + DOMPurify；失败时仅对源码做 HTML 转义，不保留 Markdown 语法可见性以外的结构。 */
export function parseMarkdownSourceToHtml(text: string, opts?: { streaming?: boolean }): string {
  const source = coerceMarkdownSourceText(text);
  if (!source.trim()) return "";
  const stabilized = opts?.streaming ? stabilizeStreamingMarkdown(source) : source;
  const unwrapped = unwrapProseFencedMarkdownSource(stabilized);
  const wrappedMermaid = wrapMermaidBlocksInMarkdown(unwrapped);
  const normalized = normalizeMarkdownForDisplay(wrappedMermaid, { streaming: opts?.streaming });
  return parseMarkedHtml(normalized, source);
}

/** @deprecated 会话消息统一走 Markdown 解析；保留别名便于测试与外部引用。 */
export function renderRichMessageSourceToHtml(text: string, opts?: { streaming?: boolean }): string {
  return parseMarkdownSourceToHtml(text, opts);
}

export type MarkdownHtmlEnhancer = {
  copyIconHtml: string;
  checkIconHtml: string;
};

const DEFAULT_ENHANCER: MarkdownHtmlEnhancer = {
  copyIconHtml:
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z"/></svg>',
  checkIconHtml:
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M5 12l3.38 2.79L15 5.83"/></svg>',
};

function readDisplayHtmlCache(key: string): string | undefined {
  const hit = displayHtmlCache.get(key);
  if (hit === undefined) return undefined;
  displayHtmlCache.delete(key);
  displayHtmlCache.set(key, hit);
  return hit;
}

function writeDisplayHtmlCache(key: string, html: string): void {
  if (displayHtmlCache.has(key)) {
    displayHtmlCache.delete(key);
  }
  displayHtmlCache.set(key, html);
  while (displayHtmlCache.size > DISPLAY_HTML_CACHE_MAX) {
    const oldest = displayHtmlCache.keys().next().value;
    if (oldest === undefined) break;
    displayHtmlCache.delete(oldest);
  }
}

/** 在已有 HTML 字符串上注入复制按钮、外链规范化等聊天展示增强。 */
function createMermaidPlaceholder(doc: Document, source: string): HTMLDivElement {
  const diagram = doc.createElement("div");
  diagram.className = "app-markdown-mermaid";
  diagram.setAttribute("role", "figure");
  diagram.setAttribute("aria-label", "流程图");
  const status = doc.createElement("div");
  status.className = "app-markdown-mermaid__status";
  status.setAttribute("role", "status");
  status.textContent = "正在渲染流程图…";
  const sourceEl = doc.createElement("pre");
  sourceEl.className = "app-markdown-mermaid__source";
  sourceEl.textContent = source;
  sourceEl.hidden = true;
  diagram.appendChild(status);
  diagram.appendChild(sourceEl);
  return diagram;
}

export function enhanceMarkdownHtmlString(
  html: string,
  doc: Document,
  enhancer: MarkdownHtmlEnhancer = DEFAULT_ENHANCER,
  depth = 0,
  opts?: { streaming?: boolean },
): string {
  if (!html.trim()) return "";
  const temp = doc.createElement("div");
  temp.innerHTML = html;

  temp.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const raw = code?.textContent ?? pre.textContent ?? "";
    const lang = extractCodeBlockLanguage(code);

    if (shouldRenderFencedBlockAsMermaid(raw, lang)) {
      if (opts?.streaming) {
        const wrapper = doc.createElement("div");
        wrapper.className = "app-markdown-code app-markdown-code--mermaid-pending";
        const copyBtn = doc.createElement("button");
        copyBtn.className = "app-markdown-copy-btn";
        copyBtn.setAttribute("aria-label", "复制");
        copyBtn.setAttribute("data-tooltip", "复制");
        copyBtn.innerHTML = `<span class="copy-icon">${enhancer.copyIconHtml}</span><span class="check-icon">${enhancer.checkIconHtml}</span>`;
        const parent = pre.parentElement;
        if (parent) {
          parent.replaceChild(wrapper, pre);
          wrapper.appendChild(pre);
          wrapper.appendChild(copyBtn);
        }
        return;
      }

      const diagram = createMermaidPlaceholder(doc, raw);
      pre.parentElement?.replaceChild(diagram, pre);
      return;
    }

    if (shouldRenderFencedBlockAsMarkdown(raw, lang)) {
      const split = splitMarkdownAndTrailingDataLines(raw);
      if (split && shouldRenderFencedBlockAsMarkdown(split.markdown, lang)) {
        const innerParsed = parseMarkdownSourceToHtml(split.markdown);
        const innerEnhanced =
          depth < ENHANCE_RECURSE_MAX_DEPTH
            ? enhanceMarkdownHtmlString(innerParsed, doc, enhancer, depth + 1, opts)
            : innerParsed;
        const prose = doc.createElement("div");
        prose.className = "app-markdown-prose-from-fence";
        prose.innerHTML = innerEnhanced;

        const wrapper = doc.createElement("div");
        wrapper.className = "app-markdown-code app-markdown-code--data-tail";
        const dataPre = doc.createElement("pre");
        const dataCode = doc.createElement("code");
        dataCode.className = code?.getAttribute("class") ?? `language-${lang || "json"}`;
        dataCode.textContent = split.dataLines;
        dataPre.appendChild(dataCode);
        wrapper.appendChild(dataPre);
        const copyBtn = doc.createElement("button");
        copyBtn.className = "app-markdown-copy-btn";
        copyBtn.setAttribute("aria-label", "复制");
        copyBtn.setAttribute("data-tooltip", "复制");
        copyBtn.innerHTML = `<span class="copy-icon">${enhancer.copyIconHtml}</span><span class="check-icon">${enhancer.checkIconHtml}</span>`;
        wrapper.appendChild(copyBtn);

        const container = doc.createElement("div");
        container.className = "app-markdown-prose-from-fence app-markdown-prose-from-fence--with-data-tail";
        container.appendChild(prose);
        container.appendChild(wrapper);
        pre.parentElement?.replaceChild(container, pre);
        return;
      }

      const innerParsed = parseMarkdownSourceToHtml(raw);
      const innerEnhanced =
        depth < ENHANCE_RECURSE_MAX_DEPTH
          ? enhanceMarkdownHtmlString(innerParsed, doc, enhancer, depth + 1, opts)
          : innerParsed;
      const prose = doc.createElement("div");
      prose.className = "app-markdown-prose-from-fence";
      prose.innerHTML = innerEnhanced;
      pre.parentElement?.replaceChild(prose, pre);
      return;
    }

    const wrapper = doc.createElement("div");
    wrapper.className = "app-markdown-code";
    const copyBtn = doc.createElement("button");
    copyBtn.className = "app-markdown-copy-btn";
    copyBtn.setAttribute("aria-label", "复制");
    copyBtn.setAttribute("data-tooltip", "复制");
    copyBtn.innerHTML = `<span class="copy-icon">${enhancer.copyIconHtml}</span><span class="check-icon">${enhancer.checkIconHtml}</span>`;
    const parent = pre.parentElement;
    if (parent) {
      parent.replaceChild(wrapper, pre);
      wrapper.appendChild(pre);
      wrapper.appendChild(copyBtn);
    }
  });

  temp.querySelectorAll(":not(pre) > code").forEach((code) => {
    const raw = code.textContent?.trim() ?? "";
    const href = normalizeAutolinkUrl(raw);
    if (href && /^https?:\/\//i.test(href) && isValidHttpUrl(href)) {
      try {
        const url = new URL(href);
        const link = doc.createElement("a");
        link.href = url.toString();
        link.className = "app-markdown-link";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        code.textContent = href;
        code.parentNode?.replaceChild(link, code);
        link.appendChild(code);
      } catch {
        /* ignore */
      }
    }
  });

  temp.querySelectorAll("a[href]").forEach((anchor) => {
    const rawHref = anchor.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(rawHref)) {
      const href = normalizeAutolinkUrl(rawHref);
      if (isValidHttpUrl(href)) {
        anchor.setAttribute("href", href);
        const anchorText = anchor.textContent ?? "";
        if (anchorText === rawHref || anchorText === tryDecodeUriForDisplay(rawHref)) {
          anchor.textContent = href;
        } else if (anchorText.startsWith(rawHref)) {
          anchor.textContent = href + anchorText.slice(rawHref.length);
        }
      }
    }
    anchor.classList.add("app-markdown-link");
    if (!anchor.getAttribute("target")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  });

  return temp.innerHTML;
}

export function buildMarkdownDisplayHtml(
  text: string,
  opts?: { streaming?: boolean; enhancer?: MarkdownHtmlEnhancer },
): string {
  const source = coerceMarkdownSourceText(text);
  if (!source.trim()) return "";
  if (typeof document === "undefined") {
    return parseMarkdownSourceToHtml(source, { streaming: opts?.streaming });
  }

  const cacheKey = opts?.streaming ? "" : source;
  if (cacheKey) {
    const cached = readDisplayHtmlCache(cacheKey);
    if (cached !== undefined) return cached;
  }

  const inner = parseMarkdownSourceToHtml(source, { streaming: opts?.streaming });
  const enhanced = enhanceMarkdownHtmlString(inner, document, opts?.enhancer, 0, {
    streaming: opts?.streaming,
  });
  if (cacheKey && enhanced) {
    writeDisplayHtmlCache(cacheKey, enhanced);
  }
  return enhanced;
}

/** 将展示 HTML 同步到容器；返回是否写入了内容。 */
export function syncMarkdownHtmlToContainer(container: HTMLElement, html: string): boolean {
  if (!html) {
    if (container.childNodes.length > 0) {
      container.replaceChildren();
    }
    return false;
  }
  if (container.innerHTML !== html) {
    container.innerHTML = html;
  }
  return true;
}

export function clearMarkdownDisplayHtmlCache(): void {
  displayHtmlCache.clear();
}
