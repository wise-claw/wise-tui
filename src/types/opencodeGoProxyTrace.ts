/** Wise 内置 OpenCode 代理 HTTP trace 条目。 */
export interface OpencodeGoProxyTraceEntry {
  id: string;
  timestampMs: number;
  method: string;
  path: string;
  claudeModel: string;
  upstreamModel: string;
  upstreamUrl: string;
  statusCode?: number;
  durationMs: number;
  isStreaming: boolean;
  requestPreview: string;
  responsePreview: string;
  errorMessage?: string;
}
