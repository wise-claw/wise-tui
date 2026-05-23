import type { ClaudeMessage } from "../types";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { FccTraceEntry } from "../types/fccTrace";
import type { SessionLinkExportBundle, SessionLinkRecord } from "../types/sessionLink";
import { countSessionLinkStats } from "./buildSessionLinkRecords";
import { buildSessionLinkRecordsFromSources } from "./sessionLinkPipeline";

export function buildSessionLinkExportBundle(params: {
  messages: readonly ClaudeMessage[];
  jsonlLines?: readonly string[] | null;
  llmProxyRecords?: readonly ClaudeLlmProxyRecord[];
  fccTraces?: readonly FccTraceEntry[];
  wiseTabSessionId?: string;
  claudeSessionId?: string | null;
  repositoryPath?: string;
  /** 导出前过滤后的记录；省略则从 sources 全量构建 */
  records?: readonly SessionLinkRecord[];
}): SessionLinkExportBundle {
  const records =
    params.records ??
    buildSessionLinkRecordsFromSources({
      messages: params.messages,
      jsonlLines: params.jsonlLines,
      llmProxyRecords: params.llmProxyRecords,
      fccTraces: params.fccTraces,
    });
  const stats = countSessionLinkStats(records);
  const fccTraceCount = records.filter((r) => r.source === "fcc_trace").length;
  return {
    exportedAt: new Date().toISOString(),
    session: {
      wiseTabSessionId: params.wiseTabSessionId,
      claudeSessionId: params.claudeSessionId,
      repositoryPath: params.repositoryPath,
    },
    records: [...records],
    sources: {
      messageCount: params.messages.length,
      jsonlTailLines: params.jsonlLines?.length ?? 0,
      llmProxyRecordCount: params.llmProxyRecords?.length ?? 0,
      fccTraceCount,
      inferredHttpCount: stats.httpInferred,
      observedHttpCount: stats.httpObserved,
    },
  };
}

export function stripSessionLinkDetailsForMetadataExport(
  bundle: SessionLinkExportBundle,
): SessionLinkExportBundle {
  return {
    ...bundle,
    records: bundle.records.map((r) => ({
      ...r,
      summary: r.summary.length > 280 ? `${r.summary.slice(0, 280)}…` : r.summary,
      detail: undefined,
    })),
  };
}

export function serializeSessionLinkExportBundle(bundle: SessionLinkExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}
