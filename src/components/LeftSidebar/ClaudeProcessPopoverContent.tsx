import { useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import { CloseOutlined } from "@ant-design/icons";
import { Button, Empty, Popconfirm } from "antd";
import type { ClaudeHostProcess, ClaudeSession, ProjectItem, Repository } from "../../types";
import type { ClaudeProcessWorkspaceLabelCacheHandle } from "../../hooks/useClaudeProcessWorkspaceLabelCache";
import {
  buildClaudeProcessPopoverCards,
  type ClaudeProcessPopoverCard,
} from "./buildClaudeProcessPopoverCards";
import "./ClaudeProcessPopoverContent.css";

interface ClaudeProcessPopoverContentProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  matchedSessions: ClaudeSession[];
  emptyDescription: string;
  projects: ReadonlyArray<ProjectItem>;
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  allSessions: ClaudeSession[];
  claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  claudeProcessLabelCache?: ClaudeProcessWorkspaceLabelCacheHandle;
  onSelectSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  /** 批量结束当前列表（含搜索过滤后）中的全部进程 */
  onBatchEndSessions?: (sessionIds: string[]) => void | Promise<void>;
}

function formatCardUpdatedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

function ClaudeProcessCard({
  card,
  onSelectSession,
  onEndSession,
}: {
  card: ClaudeProcessPopoverCard;
  onSelectSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
}) {
  const updatedAtLabel = formatCardUpdatedAt(card.updatedAt);
  const claudeSessionId = card.claudeSessionId?.trim() || "尚未解析";

  return (
    <article className="app-claude-process-popover__card">
      <button
        type="button"
        className="app-claude-process-popover__card-main"
        onClick={(event) => {
          event.stopPropagation();
          onSelectSession?.(card.sessionId);
        }}
      >
        <div className="app-claude-process-popover__card-head">
          <span className="app-claude-process-popover__card-title">{card.scopeTitle}</span>
          <span className="app-claude-process-popover__card-head-actions">
            <span className="app-claude-process-popover__card-running" aria-label="运行中" title="运行中" />
            {onEndSession ? (
              <HoverHint title="关闭 Claude 会话">
                <span
                  role="button"
                  tabIndex={0}
                  className="app-claude-process-popover__card-stop"
                  aria-label="关闭 Claude 会话"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEndSession(card.sessionId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onEndSession(card.sessionId);
                    }
                  }}
                >
                  <CloseOutlined />
                </span>
              </HoverHint>
            ) : null}
          </span>
        </div>
        <div className="app-claude-process-popover__card-meta-grid">
          <div className="app-claude-process-popover__meta-cell">
            <span className="app-claude-process-popover__meta-label">PID</span>
            <span className="app-claude-process-popover__meta-value">
              {card.pid != null ? String(card.pid) : "—"}
            </span>
          </div>
          <div className="app-claude-process-popover__meta-cell">
            <span className="app-claude-process-popover__meta-label">内存</span>
            <span className="app-claude-process-popover__meta-value">{card.memoryLabel ?? "—"}</span>
          </div>
          {updatedAtLabel ? (
            <div className="app-claude-process-popover__meta-cell app-claude-process-popover__meta-cell--full">
              <span className="app-claude-process-popover__meta-label">更新</span>
              <span className="app-claude-process-popover__meta-value">{updatedAtLabel}</span>
            </div>
          ) : null}
          <div className="app-claude-process-popover__meta-cell app-claude-process-popover__meta-cell--full">
            <span className="app-claude-process-popover__meta-label">Claude 会话 ID</span>
            <span className="app-claude-process-popover__meta-value app-claude-process-popover__meta-value--mono">
              {claudeSessionId}
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}

export function ClaudeProcessPopoverContent({
  searchValue,
  onSearchChange,
  matchedSessions,
  emptyDescription,
  projects,
  repositories,
  repositoryMainSessionBindings,
  allSessions,
  claudeProcesses,
  claudeProcessLabelCache,
  onSelectSession,
  onEndSession,
  onBatchEndSessions,
}: ClaudeProcessPopoverContentProps) {
  const [batchEnding, setBatchEnding] = useState(false);
  const cards = buildClaudeProcessPopoverCards(matchedSessions, {
    projects,
    repositories,
    bindings: repositoryMainSessionBindings,
    sessions: allSessions,
    claudeProcesses,
    searchKeyword: searchValue,
    labelCache: claudeProcessLabelCache,
  });

  const canBatchEnd = Boolean(onBatchEndSessions) && cards.length > 0;

  const handleBatchEnd = async () => {
    if (!onBatchEndSessions || cards.length === 0 || batchEnding) {
      return;
    }
    setBatchEnding(true);
    try {
      await onBatchEndSessions(cards.map((card) => card.sessionId));
    } finally {
      setBatchEnding(false);
    }
  };

  return (
    <div className="app-claude-process-popover">
      <input
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        className="app-claude-process-popover__search"
        placeholder="搜索工作区、仓库、PID、会话 ID…"
        onClick={(event) => event.stopPropagation()}
      />
      {canBatchEnd ? (
        <div
          className="app-claude-process-popover__toolbar"
          onClick={(event) => event.stopPropagation()}
        >
          <Popconfirm
            title={`确定结束列出的 ${cards.length} 个 Claude 进程？`}
            okText="全部结束"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: batchEnding }}
            onConfirm={() => void handleBatchEnd()}
          >
            <Button
              size="small"
              danger
              loading={batchEnding}
              disabled={batchEnding}
              onClick={(event) => event.stopPropagation()}
            >
              批量结束（{cards.length}）
            </Button>
          </Popconfirm>
        </div>
      ) : null}
      {cards.length > 0 ? (
        <div className="app-claude-process-popover__list">
          {cards.map((card) => (
            <ClaudeProcessCard
              key={card.rowKey}
              card={card}
              onSelectSession={onSelectSession}
              onEndSession={onEndSession}
            />
          ))}
        </div>
      ) : (
        <div className="app-claude-process-popover__empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
        </div>
      )}
    </div>
  );
}
