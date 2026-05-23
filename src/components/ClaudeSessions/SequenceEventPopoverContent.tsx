import { Button } from "antd";
import { useMemo } from "react";
import {
  formatHttpBodyJsonForDisplay,
  formatHttpTraceDetailForDisplay,
  parseHttpTraceDetailSections,
  type HttpTraceBodySectionKind,
} from "../../utils/formatHttpBodyJson";
import type { SequenceEvent } from "../../utils/claudeSessionTrajectorySequence";
import {
  HttpBodyJsonViewer,
  isHttpBodyTruncatedPreview,
} from "../ProgressMonitorPanel/HttpBodyJsonViewer";
import { JsonSyntaxHighlight } from "./systemMessageJson";
import "../ProgressMonitorPanel/LlmProxyTrafficPanel.css";

const BODY_SECTION_TITLES: Record<HttpTraceBodySectionKind, string> = {
  request: "Claude 请求 (Request)",
  response: "FCC 响应 (Response)",
  upstream: "FCC → 上游 (Upstream)",
};

const POPOVER_TEXT_LIMIT = 12_000;

function buildPopoverPlainText(ev: SequenceEvent): string {
  const detailRaw = ev.detail?.trim() ?? "";
  let detailFormatted = "";
  if (detailRaw) {
    detailFormatted =
      ev.kind === "api_request"
        ? formatHttpTraceDetailForDisplay(detailRaw)
        : formatHttpBodyJsonForDisplay(detailRaw);
  }
  const jsonl = ev.rawJsonlLine?.trim()
    ? formatHttpBodyJsonForDisplay(ev.rawJsonlLine)
    : "";
  return [ev.subtitle?.trim(), detailFormatted, jsonl].filter(Boolean).join("\n\n---\n\n");
}

interface Props {
  ev: SequenceEvent;
  onSubagentDrilldown?: (ev: SequenceEvent) => void;
}

/** 序列图 / 全链路 Popover：HTTP 接口分块 JSON 展示，其余事件缩进 + 高亮。 */
export function SequenceEventPopoverContent({ ev, onSubagentDrilldown }: Props) {
  const observedHttp =
    ev.kind === "api_request" && ev.flags.observedHttp && Boolean(ev.detail?.trim());

  const sections = useMemo(
    () => (observedHttp ? parseHttpTraceDetailSections(ev.detail!) : []),
    [observedHttp, ev.detail],
  );

  const plainText = useMemo(() => {
    if (observedHttp) return "";
    const raw = buildPopoverPlainText(ev);
    if (raw.length <= POPOVER_TEXT_LIMIT) return raw || "—";
    return `${raw.slice(0, POPOVER_TEXT_LIMIT)}…`;
  }, [observedHttp, ev]);

  if (observedHttp) {
    const metaSections = sections.filter((s) => s.kind === "meta");
    const bodySections = sections.filter(
      (s): s is { kind: HttpTraceBodySectionKind; content: string } => s.kind !== "meta",
    );

    return (
      <div className="app-seq-event-popover-card">
        <span className="app-seq-event-popover-card__badge" data-kind={ev.kind}>
          {ev.label}
        </span>
        {ev.subtitle?.trim() ? (
          <div className="app-seq-event-popover-card__meta">{ev.subtitle}</div>
        ) : null}
        {metaSections.map((sec, i) => (
          <div key={`meta-${i}`} className="app-seq-event-popover-card__meta">
            {sec.content}
          </div>
        ))}
        {bodySections.length > 0 ? (
          <div className="app-seq-event-popover-card__bodies">
            {bodySections.map((sec, i) => (
              <HttpBodyJsonViewer
                key={`${sec.kind}-${i}`}
                title={BODY_SECTION_TITLES[sec.kind]}
                rawContent={sec.content}
                defaultExpanded={sec.kind === "request"}
                isTruncated={isHttpBodyTruncatedPreview(sec.content)}
              />
            ))}
          </div>
        ) : null}
        {ev.drilldown && onSubagentDrilldown ? (
          <Button
            type="link"
            size="small"
            className="app-seq-event-popover-card__drill"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSubagentDrilldown(ev)}
          >
            查看子代理任务
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-seq-event-popover-card">
      <span className="app-seq-event-popover-card__badge" data-kind={ev.kind}>
        {ev.label}
      </span>
      <pre className="app-seq-event-popover-card__main app-seq-event-popover-card__main--highlight">
        <code>
          <JsonSyntaxHighlight text={plainText} />
        </code>
      </pre>
      {ev.drilldown && onSubagentDrilldown ? (
        <Button
          type="link"
          size="small"
          className="app-seq-event-popover-card__drill"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSubagentDrilldown(ev)}
        >
          查看子代理任务
        </Button>
      ) : null}
    </div>
  );
}
