import { isTauri } from "@tauri-apps/api/core";
import { HoverHint } from "../shared/HoverHint";
import { Popover } from "antd";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ClaudeLineEditsSnapshotResponse,
  ClaudeUsageGranularity,
  ClaudeUsageSnapshotResponse,
} from "../../services/claudeCodeUsage";
import {
  getClaudeCodeLineEditsSnapshot,
  getClaudeCodeUsageSnapshot,
  invalidateClaudeCodeUsageSnapshotCache,
} from "../../services/claudeCodeUsage";
import {
  getClaudeUsageUiStoreSnapshot,
  subscribeClaudeUsageUiStore,
} from "../../stores/claudeUsageUiStore";
import { ClaudeLineEditsContent } from "./ClaudeLineEditsContent";
import { ClaudeUsageChartContent } from "./ClaudeUsageChartContent";
import { ClaudeUsageToolbar } from "./ClaudeUsageToolbar";
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
type UsageView = "tokens" | "lineEdits";

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
  const [view, setView] = useState<UsageView>("tokens");
  const [granularity, setGranularity] = useState<ClaudeUsageGranularity>("day");
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshotResponse | null>(null);
  const [lineEditsSnapshot, setLineEditsSnapshot] = useState<ClaudeLineEditsSnapshotResponse | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [lineEditsLoading, setLineEditsLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [lineEditsError, setLineEditsError] = useState<string | null>(null);

  const repoPath = repositoryPath?.trim() || "";
  const effectiveScope: UsageScope = repoPath ? scope : "global";
  const projectPath = effectiveScope === "repository" ? repoPath : null;

  useEffect(() => {
    if (uiSnap.usagePopoverOpenNonce === lastOpenNonce.current) return;
    lastOpenNonce.current = uiSnap.usagePopoverOpenNonce;
    setOpen(true);
  }, [uiSnap.usagePopoverOpenNonce]);

  const loadTokenSnapshot = useCallback(async () => {
    if (!isTauri()) {
      setSnapshot(null);
      setSnapshotError("用量统计仅在 Wise 桌面版中可用。");
      return;
    }
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const res = await getClaudeCodeUsageSnapshot({ projectPath });
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
  }, [projectPath]);

  const loadLineEditsSnapshot = useCallback(async () => {
    if (!isTauri()) {
      setLineEditsSnapshot(null);
      setLineEditsError("代码编辑量统计仅在 Wise 桌面版中可用。");
      return;
    }
    setLineEditsLoading(true);
    setLineEditsError(null);
    try {
      const res = await getClaudeCodeLineEditsSnapshot({ projectPath });
      setLineEditsSnapshot(res);
      if (!res) {
        setLineEditsError("无法读取代码编辑量数据。");
      }
    } catch (e) {
      setLineEditsSnapshot(null);
      setLineEditsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLineEditsLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (!open) return;
    void loadTokenSnapshot();
    void loadLineEditsSnapshot();
  }, [open, loadTokenSnapshot, loadLineEditsSnapshot]);

  const handleRefresh = useCallback(() => {
    invalidateClaudeCodeUsageSnapshotCache(projectPath);
    setSnapshot(null);
    setLineEditsSnapshot(null);
    setSnapshotError(null);
    setLineEditsError(null);
    void loadTokenSnapshot();
    void loadLineEditsSnapshot();
  }, [loadLineEditsSnapshot, loadTokenSnapshot, projectPath]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setView("tokens");
          setGranularity("day");
          setSnapshot(null);
          setLineEditsSnapshot(null);
          setSnapshotError(null);
          setLineEditsError(null);
        }
      }}
      trigger="click"
      placement="bottomRight"
      destroyOnHidden
      overlayClassName={`app-cc-usage-popover-overlay${view === "lineEdits" ? " app-cc-usage-popover-overlay--wide" : ""}`}
      content={
        <div className="app-cc-usage-popover-body">
          <ClaudeUsageToolbar
            view={view}
            onViewChange={setView}
            scope={effectiveScope}
            onScopeChange={(next) => {
              setScope(next);
              setSnapshot(null);
              setLineEditsSnapshot(null);
              setSnapshotError(null);
              setLineEditsError(null);
            }}
            showScope={Boolean(repoPath)}
          />
          {view === "tokens" ? (
            <ClaudeUsageChartContent
              granularity={granularity}
              onGranularityChange={setGranularity}
              snapshot={snapshot}
              snapshotLoading={snapshotLoading}
              snapshotError={snapshotError}
              onRefresh={handleRefresh}
            />
          ) : (
            <ClaudeLineEditsContent
              snapshot={lineEditsSnapshot}
              snapshotLoading={lineEditsLoading}
              snapshotError={lineEditsError}
              onRefresh={handleRefresh}
            />
          )}
        </div>
      }
    >
      <HoverHint title="AI 用量（Token + 代码编辑量）" open={open ? false : undefined}>
        <button type="button" className="app-left-sidebar-topbar-btn" aria-label="AI 用量统计">
          <IconClaudeUsage />
        </button>
      </HoverHint>
    </Popover>
  );
}
