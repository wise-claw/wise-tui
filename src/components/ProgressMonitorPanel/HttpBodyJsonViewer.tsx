import { CheckOutlined, CopyOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useMemo, useState } from "react";
import { JsonSyntaxHighlight } from "../ClaudeSessions/systemMessageJson";
import {
  formatHttpBodyJsonForDisplay,
  HTTP_BODY_TRUNCATION_MARKER,
} from "../../utils/formatHttpBodyJson";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isHttpBodyTruncatedPreview(raw: string | null | undefined): boolean {
  return Boolean(raw?.includes(HTTP_BODY_TRUNCATION_MARKER));
}

export interface HttpBodyJsonViewerProps {
  title: string;
  rawContent: string;
  isTruncated?: boolean;
  defaultExpanded?: boolean;
  emptyHint?: string;
}

/** FCC / LLM 代理请求响应体：缩进 JSON + 语法高亮。 */
export function HttpBodyJsonViewer({
  title,
  rawContent,
  isTruncated,
  defaultExpanded = true,
  emptyHint,
}: HttpBodyJsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const prettyJson = useMemo(() => formatHttpBodyJsonForDisplay(rawContent), [rawContent]);
  const formatted = prettyJson !== rawContent.trim() && prettyJson.trim().length > 0;
  const hasBody = prettyJson.trim().length > 0;
  const showTruncatedBadge = isTruncated ?? isHttpBodyTruncatedPreview(rawContent);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(prettyJson).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [prettyJson],
  );

  const toggleExpanded = useCallback(() => {
    if (!hasBody) return;
    setExpanded((prev) => !prev);
  }, [hasBody]);

  return (
    <div
      className={
        "app-llm-proxy-json-viewer" +
        (expanded ? "" : " app-llm-proxy-json-viewer--collapsed")
      }
    >
      <div
        className={
          "app-llm-proxy-json-viewer__header" +
          (hasBody ? " app-llm-proxy-json-viewer__header--toggle" : "")
        }
        role={hasBody ? "button" : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        onClick={hasBody ? toggleExpanded : undefined}
        onKeyDown={
          hasBody
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpanded();
                }
              }
            : undefined
        }
      >
        <div className="app-llm-proxy-json-viewer__title-group">
          {hasBody ? (
            <span className="app-llm-proxy-json-viewer__chevron" aria-hidden>
              {expanded ? <DownOutlined /> : <RightOutlined />}
            </span>
          ) : null}
          <span className="app-llm-proxy-json-viewer__title">{title}</span>
          {showTruncatedBadge ? (
            <span className="app-llm-proxy-json-viewer__badge app-llm-proxy-json-viewer__badge--warning">
              已截断
            </span>
          ) : formatted ? (
            <span className="app-llm-proxy-json-viewer__badge">JSON</span>
          ) : null}
          {!expanded && hasBody ? (
            <span className="app-llm-proxy-json-viewer__size-hint">{formatBytes(prettyJson.length)}</span>
          ) : null}
        </div>
        <Button
          size="small"
          type="text"
          icon={
            copied ? (
              <CheckOutlined style={{ color: "var(--ant-color-success)" }} />
            ) : (
              <CopyOutlined />
            )
          }
          onClick={handleCopy}
          className="app-llm-proxy-json-viewer__copy-btn"
          disabled={!hasBody}
        >
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      {expanded ? (
        hasBody ? (
          <div className="app-llm-proxy-json-viewer__code-wrapper">
            <pre className="app-llm-proxy-json-viewer__code">
              <code>
                <JsonSyntaxHighlight text={prettyJson} />
              </code>
            </pre>
          </div>
        ) : emptyHint ? (
          <p className="app-llm-proxy-json-viewer__empty-hint">{emptyHint}</p>
        ) : null
      ) : null}
    </div>
  );
}
