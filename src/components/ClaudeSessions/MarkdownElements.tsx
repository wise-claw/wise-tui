import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { message } from "antd";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeExternalHref, openExternalUrl } from "../../services/openExternal";
import { highlightMarkdownCode, formatMarkdownCodeLanguageLabel } from "../../utils/markdownCodeHighlight";
import { planFencedBlockDisplay, prepareMarkdownForDisplay } from "../../utils/markdownRenderPipeline";
import { renderMermaidInContainer } from "../../utils/mermaidRender";
import "./markdownCodeHighlight.css";

const MAX_NESTED_MARKDOWN_DEPTH = 4;

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M5 12l3.38 2.79L15 5.83" />
    </svg>
  );
}

function extractFenceLanguage(className?: string): string {
  if (!className) return "";
  const match = /\blanguage-([^\s]+)/.exec(className);
  return match?.[1]?.trim() ?? "";
}

function flattenCodeChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map((child) => flattenCodeChildren(child)).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return flattenCodeChildren(props?.children ?? "");
  }
  return String(children ?? "");
}

const MarkdownCopyButton = memo(function MarkdownCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => message.error("复制失败"));
  }, [text]);

  return (
    <button
      type="button"
      className="app-markdown-copy-btn"
      aria-label="复制"
      data-tooltip={copied ? "已复制" : "复制"}
      data-copied={copied ? "true" : undefined}
      onClick={handleCopy}
    >
      <span className="copy-icon">{copied ? <CheckIcon /> : <CopyIcon />}</span>
    </button>
  );
});

const MarkdownFencedCodeBlock = memo(function MarkdownFencedCodeBlock({
  text,
  lang,
  className,
  streaming,
  preProps,
  codeChildren,
  wrapperClassName = "",
}: {
  text: string;
  lang: string;
  className: string;
  streaming: boolean;
  preProps: ComponentPropsWithoutRef<"pre">;
  codeChildren: ReactNode;
  wrapperClassName?: string;
}) {
  const highlighted = useMemo(() => {
    if (streaming || !text.trim()) return null;
    return highlightMarkdownCode(text, lang);
  }, [lang, streaming, text]);

  const codeClassName = highlighted?.resolvedLang
    ? `hljs language-${highlighted.resolvedLang}`
    : className || "hljs";
  const languageLabel = formatMarkdownCodeLanguageLabel(highlighted?.resolvedLang || lang);

  return (
    <div className={`app-markdown-code${wrapperClassName ? ` ${wrapperClassName}` : ""}`}>
      {languageLabel ? (
        <div className="app-markdown-code__head">
          <span className="app-markdown-code__lang">{languageLabel}</span>
        </div>
      ) : null}
      <pre {...preProps}>
        {highlighted ? (
          <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlighted.html }} />
        ) : (
          <code className={className}>{codeChildren}</code>
        )}
      </pre>
      <MarkdownCopyButton text={text} />
    </div>
  );
});

const MarkdownMermaidBlock = memo(function MarkdownMermaidBlock({
  source,
  streaming,
}: {
  source: string;
  streaming: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const block = ref.current;
    if (!block || streaming) return;
    void renderMermaidInContainer(block);
  }, [source, streaming]);

  if (streaming) {
    return (
      <div className="app-markdown-code app-markdown-code--mermaid-pending">
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
        <MarkdownCopyButton text={source} />
      </div>
    );
  }

  return (
    <div ref={ref} className="app-markdown-mermaid" role="figure" aria-label="流程图">
      <div className="app-markdown-mermaid__status" role="status">
        正在渲染流程图…
      </div>
      <pre className="app-markdown-mermaid__source" hidden>
        {source}
      </pre>
    </div>
  );
});

export const MarkdownBody = memo(function MarkdownBody({
  source,
  streaming = false,
  depth = 0,
  components: componentsOverrides,
  rehypePlugins,
}: {
  source: string;
  streaming?: boolean;
  depth?: number;
  components?: Partial<Components>;
  rehypePlugins?: readonly any[];
}) {
  const displaySource = useMemo(
    () => (depth === 0 ? source : prepareMarkdownForDisplay(source, { streaming })),
    [depth, source, streaming],
  );
  const defaultComponents = useMemo(
    () => createMarkdownComponents({ streaming, depth }),
    [streaming, depth],
  );
  const mergedComponents = useMemo(
    () => (componentsOverrides ? { ...defaultComponents, ...componentsOverrides } : defaultComponents),
    [defaultComponents, componentsOverrides],
  );

  if (!displaySource.trim()) return null;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mergedComponents}>
      {displaySource}
    </ReactMarkdown>
  );
});

export function createMarkdownComponents(opts: {
  streaming: boolean;
  depth: number;
}): Components {
  const { streaming, depth } = opts;

  return {
    a: ({ href, children, ...props }) => (
      <a
        {...props}
        href={href}
        className="app-markdown-link"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!href || !isSafeExternalHref(href)) return;
          event.preventDefault();
          event.stopPropagation();
          void openExternalUrl(href);
        }}
      >
        {children}
      </a>
    ),
    h1: ({ children }) => <h3 className="app-markdown-h">{children}</h3>,
    h2: ({ children }) => <h4 className="app-markdown-h">{children}</h4>,
    h3: ({ children }) => <h5 className="app-markdown-h">{children}</h5>,
    pre: ({ children, ...props }) => {
      const child = Array.isArray(children) ? children[0] : children;
      let className = "";
      let text = "";
      if (child && typeof child === "object" && "props" in child) {
        const codeProps = (child as { props?: { className?: string; children?: ReactNode } }).props ?? {};
        className = codeProps.className ?? "";
        text = flattenCodeChildren(codeProps.children).replace(/\n$/, "");
      } else {
        text = flattenCodeChildren(children).replace(/\n$/, "");
      }

      if (!text.trim()) {
        return <pre {...props}>{children}</pre>;
      }

      const lang = extractFenceLanguage(className);
      const plan = planFencedBlockDisplay(text, lang);

      if (plan.kind === "mermaid") {
        return <MarkdownMermaidBlock source={plan.text} streaming={streaming} />;
      }

      if (plan.kind === "markdown" && depth < MAX_NESTED_MARKDOWN_DEPTH) {
        return (
          <div className="app-markdown-prose-from-fence">
            <MarkdownBody source={plan.text} streaming={false} depth={depth + 1} />
          </div>
        );
      }

      if (plan.kind === "markdown-plus-data" && depth < MAX_NESTED_MARKDOWN_DEPTH) {
        const dataLang = plan.lang || "json";
        return (
          <div className="app-markdown-prose-from-fence app-markdown-prose-from-fence--with-data-tail">
            <MarkdownBody source={plan.markdown} streaming={false} depth={depth + 1} />
            <MarkdownFencedCodeBlock
              text={plan.dataLines}
              lang={dataLang}
              className={className || `language-${dataLang}`}
              streaming={false}
              preProps={props}
              codeChildren={plan.dataLines}
              wrapperClassName="app-markdown-code--data-tail"
            />
          </div>
        );
      }

      return (
        <MarkdownFencedCodeBlock
          text={text}
          lang={lang}
          className={className}
          streaming={streaming}
          preProps={props}
          codeChildren={
            child && typeof child === "object" && "props" in child
              ? (child as { props?: { children?: ReactNode } }).props?.children
              : children
          }
        />
      );
    },
    code: ({ className, children, node: _node, ...props }) => (
      <code className={className} {...props}>
        {children}
      </code>
    ),
    table: ({ children, ...props }) => (
      <div className="app-markdown-table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
  };
}
