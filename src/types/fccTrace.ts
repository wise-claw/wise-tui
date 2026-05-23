/** FCC HTTP trace 条目（与 design/session-data-link-observability/ARCHITECTURE §4.1 对齐）。 */

export interface FccTraceEntry {
  id: string;
  timestampMs: number;
  method: string;
  path: string;
  statusCode?: number | null;
  durationMs?: number | null;
  model?: string | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
  sessionHint?: string | null;
  anthropicRequestId?: string | null;
  upstreamPreview?: string | null;
}
