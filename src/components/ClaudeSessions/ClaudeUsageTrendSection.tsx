import { Typography } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { ClaudeUsageGranularity, ClaudeUsageSnapshotResponse } from "../../services/claudeCodeUsage";
import {
  getClaudeCodeUsageSnapshot,
  invalidateClaudeCodeUsageSnapshotCache,
} from "../../services/claudeCodeUsage";
import { requestOpenUsagePopover } from "../../stores/claudeUsageUiStore";
import { ClaudeUsageChartContent } from "../ClaudeCodeUsagePopover/ClaudeUsageChartContent";

interface Props {
  repositoryPath?: string | null;
}

/** 洞察页内嵌：当前仓库 JSONL 用量趋势。 */
export function ClaudeUsageTrendSection({ repositoryPath }: Props) {
  const repoPath = repositoryPath?.trim() ?? "";
  const [granularity, setGranularity] = useState<ClaudeUsageGranularity>("day");
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!repoPath) {
      setSnapshot(null);
      setError("无仓库路径，无法加载仓库用量。");
      return;
    }
    if (!isTauri()) {
      setSnapshot(null);
      setError("用量统计仅在 Wise 桌面版中可用。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getClaudeCodeUsageSnapshot({ projectPath: repoPath });
      setSnapshot(res);
      if (!res) setError("无法读取用量数据。");
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    invalidateClaudeCodeUsageSnapshotCache(repoPath || null);
    setSnapshot(null);
    setError(null);
    void load();
  }, [load, repoPath]);

  if (!repoPath) return null;

  return (
    <section className="app-session-insights__section app-session-insights__usage-trend">
      <div className="app-session-insights__section-head">
        <Typography.Text className="app-session-insights__section-title">仓库用量趋势</Typography.Text>
        <Typography.Link style={{ fontSize: 11 }} onClick={requestOpenUsagePopover}>
          全局用量
        </Typography.Link>
      </div>
      <ClaudeUsageChartContent
        granularity={granularity}
        onGranularityChange={setGranularity}
        snapshot={snapshot}
        snapshotLoading={loading}
        snapshotError={error}
        onRefresh={handleRefresh}
        compact
      />
    </section>
  );
}
