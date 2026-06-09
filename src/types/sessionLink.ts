/** 会话全链路分析记录层（见 design/session-data-link-observability/）。 */

export type SessionLinkLayer =
  | "input"
  | "protocol"
  | "tool"
  | "hook"
  | "http"
  | "fcc_upstream";

export type SessionLinkObservedSource =
  | "memory"
  | "jsonl"
  | "inferred"
  | "llm_proxy"
  | "fcc_trace"
  | "opencode_go_proxy";

export interface SessionLinkRecord {
  id: string;
  timestampMs: number;
  layer: SessionLinkLayer;
  kind: string;
  turnIndex: number;
  summary: string;
  detail?: string;
  observed: boolean;
  source: SessionLinkObservedSource;
  messageId?: number;
  toolUseId?: string;
  httpTraceId?: string;
  refs?: {
    sequenceEventId?: string;
    jsonlLineNo?: number;
    llmProxyRecordId?: string;
    fccTraceId?: string;
    opencodeGoProxyTraceId?: string;
  };
}

export interface SessionLinkExportBundle {
  exportedAt: string;
  session: {
    wiseTabSessionId?: string;
    claudeSessionId?: string | null;
    repositoryPath?: string;
  };
  records: SessionLinkRecord[];
  sources: {
    messageCount: number;
    jsonlTailLines: number;
    llmProxyRecordCount: number;
    fccTraceCount: number;
    opencodeGoProxyTraceCount: number;
    inferredHttpCount: number;
    observedHttpCount: number;
  };
}
