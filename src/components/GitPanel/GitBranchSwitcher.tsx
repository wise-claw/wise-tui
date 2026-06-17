import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { Button, Checkbox, Empty, Input, Modal, Popconfirm, Popover, Select, Spin, message } from "antd";
import { gitCheckoutBranch, gitCreateBranch, gitDeleteBranch, gitListBranches, gitStatus } from "../../services/git";
import type { GitBranchEntry } from "../../types";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return "";
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - timestamp);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

export interface GitBranchSwitcherProps {
  repositoryPath: string;
  branchHint?: string | null;
  onBranchChanged?: () => void;
  className?: string;
}

export function GitBranchSwitcher({
  repositoryPath,
  branchHint,
  onBranchChanged,
  className,
}: GitBranchSwitcherProps) {
  const [activeBranch, setActiveBranch] = useState<string>(branchHint?.trim() || "-");
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateFromRef, setBranchCreateFromRef] = useState<string | undefined>(undefined);
  const [branchCreateNoTrack, setBranchCreateNoTrack] = useState(true);
  const branchCreateDraftRef = useRef({
    name: "",
    fromRef: undefined as string | undefined,
    noTrack: true,
  });
  branchCreateDraftRef.current = {
    name: branchCreateName,
    fromRef: branchCreateFromRef,
    noTrack: branchCreateNoTrack,
  };
  const [branchListLoading, setBranchListLoading] = useState(false);
  const [branchActionLoading, setBranchActionLoading] = useState(false);
  const [branchDeletingName, setBranchDeletingName] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);

  useEffect(() => {
    const next = branchHint?.trim();
    if (next) setActiveBranch(next);
  }, [branchHint]);

  const loadActiveBranch = useCallback(async () => {
    if (!repositoryPath) {
      setActiveBranch("-");
      return;
    }
    try {
      const status = await gitStatus(repositoryPath);
      setActiveBranch(status.branch?.trim() || "(detached)");
    } catch {
      setActiveBranch("-");
    }
  }, [repositoryPath]);

  const loadBranches = useCallback(async () => {
    if (!repositoryPath) {
      setBranches([]);
      setActiveBranch("-");
      return;
    }
    setBranchListLoading(true);
    try {
      const list = await gitListBranches(repositoryPath);
      setBranches(list);
      const current = list.find((item) => item.isCurrent && !item.isRemote);
      if (current?.name) {
        setActiveBranch(current.name);
      } else {
        await loadActiveBranch();
      }
    } catch {
      /* ignore */
    } finally {
      setBranchListLoading(false);
    }
  }, [loadActiveBranch, repositoryPath]);

  const handleCheckoutBranch = useCallback(
    async (name: string) => {
      if (!name.trim() || !repositoryPath) return;
      setBranchActionLoading(true);
      try {
        await gitCheckoutBranch(repositoryPath, name.trim());
        setActiveBranch(name.trim());
        await loadBranches();
        onBranchChanged?.();
      } catch {
        /* ignore */
      } finally {
        setBranchActionLoading(false);
      }
    },
    [loadBranches, onBranchChanged, repositoryPath],
  );

  const handleCreateBranch = useCallback(async () => {
    const draft = branchCreateDraftRef.current;
    const name = draft.name.trim();
    if (!name || !repositoryPath) return;
    setBranchActionLoading(true);
    try {
      await gitCreateBranch(
        repositoryPath,
        name,
        draft.fromRef ?? null,
        true,
        draft.noTrack,
      );
      setBranchCreateName("");
      setActiveBranch(name);
      await loadBranches();
      onBranchChanged?.();
    } catch {
      /* ignore */
    } finally {
      setBranchActionLoading(false);
    }
  }, [loadBranches, onBranchChanged, repositoryPath]);

  const handleDeleteBranch = useCallback(
    async (name: string, force = false) => {
      if (!name.trim() || !repositoryPath) return;
      setBranchDeletingName(name.trim());
      try {
        await gitDeleteBranch(repositoryPath, name.trim(), force);
        await loadBranches();
        onBranchChanged?.();
        message.success(`已删除本地分支 ${name.trim()}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (!force && /not fully merged|未完全合并|not merged/i.test(errMsg)) {
          Modal.confirm({
            title: `强制删除本地分支「${name.trim()}」？`,
            content: "该分支含未合并提交，强制删除后无法通过此分支访问这些提交。",
            okText: "强制删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => handleDeleteBranch(name, true),
          });
          return;
        }
        message.error(`删除分支失败：${errMsg}`);
      } finally {
        setBranchDeletingName(null);
      }
    },
    [loadBranches, onBranchChanged, repositoryPath],
  );

  const stopPopoverPointerBubble = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);

  const filteredBranches = useMemo(() => {
    const keyword = branchQuery.trim().toLowerCase();
    if (!keyword) return branches;
    return branches.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [branches, branchQuery]);

  const localBranches = useMemo(
    () => filteredBranches.filter((item) => !item.isRemote),
    [filteredBranches],
  );

  const remoteBranches = useMemo(
    () => filteredBranches.filter((item) => item.isRemote),
    [filteredBranches],
  );

  useEffect(() => {
    void loadActiveBranch();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadActiveBranch();
    }, readVisiblePollIntervalMs(30_000, 120_000));
    return () => window.clearInterval(timer);
  }, [loadActiveBranch]);

  useEffect(() => {
    if (!branchPopoverOpen) return;
    void loadBranches();
  }, [branchPopoverOpen, loadBranches]);

  if (!repositoryPath) return null;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={branchPopoverOpen}
      onOpenChange={(open) => {
        setBranchPopoverOpen(open);
        if (!open) {
          setBranchQuery("");
          setBranchCreateName("");
          setBranchCreateFromRef(undefined);
        }
      }}
      overlayClassName="app-claude-branch-popover"
      content={
        <div
          className="app-claude-branch-popover__content"
          onMouseDown={stopPopoverPointerBubble}
          onClick={stopPopoverPointerBubble}
        >
          <div className="app-claude-branch-popover__controls">
            <Input
              size="small"
              placeholder="搜索分支..."
              className="app-claude-branch-popover__search-input"
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
            />
            <div className="app-claude-branch-popover__section-title">创建分支</div>
            <div className="app-claude-branch-popover__create-inline-row">
              <Input
                size="small"
                placeholder="新分支名"
                className="app-claude-branch-popover__branch-name-input"
                value={branchCreateName}
                onChange={(event) => setBranchCreateName(event.target.value)}
                onPressEnter={() => void handleCreateBranch()}
                disabled={branchActionLoading}
              />
              <Select
                size="small"
                allowClear
                placeholder="基线(可选)"
                className="app-claude-branch-popover__from-select"
                value={branchCreateFromRef}
                onChange={(value) => setBranchCreateFromRef(value)}
                options={branches.map((item) => ({ value: item.name, label: item.name }))}
                disabled={branchActionLoading || branchListLoading}
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                popupClassName="app-claude-branch-popover__select-dropdown"
              />
              <Button
                size="small"
                type="primary"
                htmlType="button"
                className="app-claude-branch-popover__action-btn"
                onMouseDown={stopPopoverPointerBubble}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCreateBranch();
                }}
                loading={branchActionLoading}
              >
                新建
              </Button>
            </div>
            <Checkbox
              className="app-claude-branch-popover__no-track-option"
              checked={branchCreateNoTrack}
              onChange={(event) => setBranchCreateNoTrack(event.target.checked)}
              disabled={branchActionLoading}
            >
              不设置上游跟踪（--no-track）
            </Checkbox>
          </div>
          <div className="app-claude-branch-popover__list">
            {branchListLoading ? (
              <div className="app-claude-branch-popover__loading">
                <Spin size="small" />
              </div>
            ) : filteredBranches.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配分支" />
            ) : (
              <>
                {localBranches.length > 0 && (
                  <>
                    <div className="app-claude-branch-popover__section-title">本地分支</div>
                    {localBranches.map((item) => (
                      <div
                        key={`local-${item.name}`}
                        className={`app-claude-branch-popover__item-wrap${item.isCurrent ? " app-claude-branch-popover__item-wrap--active" : ""}`}
                      >
                        <button
                          type="button"
                          className={`app-claude-branch-popover__item ${item.isCurrent ? "app-claude-branch-popover__item--active" : ""}`}
                          onClick={() => void handleCheckoutBranch(item.name)}
                          disabled={branchActionLoading || branchDeletingName != null}
                        >
                          <span className="app-claude-branch-popover__item-name">{item.name}</span>
                          <span className="app-claude-branch-popover__item-meta">
                            {item.author ? `${item.author} · ` : ""}
                            {formatRelativeTime(item.lastCommitTimestamp)}
                          </span>
                        </button>
                        {!item.isCurrent ? (
                          <Popconfirm
                            title={`删除本地分支「${item.name}」？`}
                            description="已合并分支将安全删除；若含未合并提交需二次确认强制删除。"
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true, size: "small" }}
                            cancelButtonProps={{ size: "small" }}
                            onConfirm={() => void handleDeleteBranch(item.name, false)}
                            onCancel={(event) => event?.stopPropagation()}
                          >
                            <Button
                              type="text"
                              size="small"
                              className="app-claude-branch-popover__item-delete"
                              icon={<DeleteOutlined />}
                              aria-label={`删除分支 ${item.name}`}
                              title="删除分支"
                              loading={branchDeletingName === item.name}
                              disabled={
                                branchActionLoading ||
                                (branchDeletingName != null && branchDeletingName !== item.name)
                              }
                              onMouseDown={stopPopoverPointerBubble}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </Popconfirm>
                        ) : null}
                      </div>
                    ))}
                  </>
                )}
                {remoteBranches.length > 0 && (
                  <>
                    <div className="app-claude-branch-popover__section-title">远程分支</div>
                    {remoteBranches.map((item) => (
                      <button
                        key={`remote-${item.name}`}
                        type="button"
                        className={`app-claude-branch-popover__item ${item.isCurrent ? "app-claude-branch-popover__item--active" : ""}`}
                        onClick={() => void handleCheckoutBranch(item.name)}
                        disabled={branchActionLoading}
                      >
                        <span className="app-claude-branch-popover__item-name">{item.name}</span>
                        <span className="app-claude-branch-popover__item-meta">
                          {item.author ? `${item.author} · ` : ""}
                          {formatRelativeTime(item.lastCommitTimestamp)}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        className={`app-claude-branch-trigger git-branch-switcher-trigger${className ? ` ${className}` : ""}`}
        title="切换分支"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="6" y1="3" x2="6" y2="19" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="git-branch-switcher-trigger__name">{activeBranch}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </Button>
    </Popover>
  );
}
