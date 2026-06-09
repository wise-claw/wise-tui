import { isTauri } from "@tauri-apps/api/core";
import { HoverHint } from "../shared/HoverHint";
import { Popover, Segmented, Typography } from "antd";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ClaudeUsageGranularity, ClaudeUsageSnapshotResponse } from "../../services/claudeCodeUsage";
import { getClaudeCodeUsageSnapshot } from "../../services/claudeCodeUsage";
import {
  getClaudeUsageUiStoreSnapshot,
  requestOpenSessionDataLink,
  subscribeClaudeUsageUiStore,
} from "../../stores/claudeUsageUiStore";
import { ClaudeUsageChartContent } from "./ClaudeUsageChartContent";
import "./index.css";

function IconClaudeUsage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <polygon points="12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="12 7.5 16 9.75 16 14.25 12 16.5 8 14.25 8 9.75" stroke="currentColor" strokeWidth="1.8" strokeOpacity="0.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

type UsageScope = "global" | "repository";

interface Props {
  repositoryPath?: string | null;
}

export function ClaudeCodeUsageHeaderBtn({ repositoryPath }: Props) {
  const uiSnap = useSyncExternalStore(
    subscribeClaudeUsageUiStore,
    getClaudeUsageUiStoreSnapshot,
    getClaudeUsageUiStoreSnapshot,
  );
  const lastOpenNonce = useRef(uiSnap.usagePopoverOpenNonce);

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<UsageScope>("global");
  const [granularity, setGranularity] = useState<ClaudeUsageGranularity>("day");
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshotResponse | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const repoPath = repositoryPath?.trim() || "";
  const effectiveScope: UsageScope = repoPath ? scope : "global";

  useEffect(() => {
    if (uiSnap.usagePopoverOpenNonce === lastOpenNonce.current) return;
    lastOpenNonce.current = uiSnap.usagePopoverOpenNonce;
    setOpen(true);
  }, [uiSnap.usagePopoverOpenNonce]);

  const loadSnapshot = useCallback(async () => {
    if (!isTauri()) {
      setSnapshot(null);
      setSnapshotError("用量统计仅在 Wise 桌面版中可用。");
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const res = await getClaudeCodeUsageSnapshot({
        projectPath: effectiveScope === "repository" ? repoPath : null,
      });
      setSnapshot(res);
      if (!res) {
        setSnapshotError("无法读取用量数据。");
      }
    } catch (e) {
      setSnapshot(null);
      setSnapshotError(e instanceof Error ? e.message : String(e));
    } finally {
      setSnapshotLoading(false);
    }
  }, [effectiveScope, repoPath]);

  useEffect(() => {
    if (!open) return;
    void loadSnapshot();
  }, [open, loadSnapshot]);

  const handleRefresh = useCallback(() => {
    setSnapshot(null);
    setSnapshotError(null);
    void loadSnapshot();
  }, [loadSnapshot]);

  const footerExtra = (
    <>
      {repoPath ? (
        <>
          {" "}
          ·{" "}
          <Typography.Link
            onClick={() => {
              setOpen(false);
              requestOpenSessionDataLink("insights");
            }}
          >
            全链路洞察
          </Typography.Link>
        </>
      ) : null}
    </>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setGranularity("day");
          setSnapshot(null);
          setSnapshotError(null);
        }
      }}
      trigger="click"
      placement="bottomRight"
      destroyOnHidden
      content={
        <div>
          {repoPath ? (
            <Segmented<UsageScope>
              size="small"
              block
              className="app-cc-usage-scope"
              value={effectiveScope}
              onChange={(v) => {
                const s = String(v);
                if (s === "global" || s === "repository") {
                  setScope(s);
                  setSnapshot(null);
                  setSnapshotError(null);
                }
              }}
              options={[
                { label: "全局", value: "global" },
                { label: "本仓库", value: "repository" },
              ]}
            />
          ) : null}
          <ClaudeUsageChartContent
            granularity={granularity}
            onGranularityChange={setGranularity}
            snapshot={snapshot}
            snapshotLoading={snapshotLoading}
            snapshotError={snapshotError}
            onRefresh={handleRefresh}
            footerExtra={footerExtra}
          />
        </div>
      }
    >
      <HoverHint title="Claude Code 用量（本机 JSONL，对齐 ccusage）" open={open ? false : undefined}>
        <button type="button" className="app-left-sidebar-topbar-btn" aria-label="Claude Code 用量统计">
          <IconClaudeUsage />
        </button>
      </HoverHint>
    </Popover>
  );
}
