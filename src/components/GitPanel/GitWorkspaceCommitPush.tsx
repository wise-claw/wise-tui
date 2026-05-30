import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Popover, Spin, Tooltip, message } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import {
  commitAndPushWorkspaceRepositories,
  countGitWorkspaceDirtyRepositories,
  summarizeGitWorkspaceSyncResults,
  type GitWorkspaceRepositoryRef,
} from "../../services/gitWorkspaceSync";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";

const { TextArea } = Input;

interface Props {
  repositoryEntries: GitPanelRepositoryEntry[];
  onAfterSync?: () => void;
}

export function GitWorkspaceCommitPush({ repositoryEntries, onAfterSync }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [dirtyRepoCount, setDirtyRepoCount] = useState(0);
  const loadSeqRef = useRef(0);

  const loadDirtyRepoCount = useCallback(async (seq: number) => {
    if (repositoryEntries.length === 0) return;
    setLoadingDraft(true);
    setProgressLabel("");
    try {
      const refs: GitWorkspaceRepositoryRef[] = repositoryEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
      }));
      const dirtyCount = await countGitWorkspaceDirtyRepositories(refs);
      if (seq !== loadSeqRef.current) return;
      setDirtyRepoCount(dirtyCount);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setDirtyRepoCount(0);
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`读取工作区 Git 状态失败：${errMsg}`);
    } finally {
      if (seq === loadSeqRef.current) {
        setLoadingDraft(false);
      }
    }
  }, [repositoryEntries]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        loadSeqRef.current += 1;
        setProgressLabel("");
        setDraft("");
        return;
      }
      setDraft("");
      loadSeqRef.current += 1;
      const seq = loadSeqRef.current;
      void loadDirtyRepoCount(seq);
    },
    [loadDirtyRepoCount],
  );

  useEffect(
    () => () => {
      loadSeqRef.current += 1;
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    const commitMessage = draft.trim();
    if (!commitMessage) {
      message.warning("请先填写提交信息");
      return;
    }
    if (repositoryEntries.length === 0) {
      message.warning("当前工作区没有可提交的仓库");
      return;
    }

    const refs: GitWorkspaceRepositoryRef[] = repositoryEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
    }));

    setSubmitting(true);
    try {
      const results = await commitAndPushWorkspaceRepositories(refs, commitMessage, (current, index, total) => {
        setProgressLabel(`正在处理 ${current.name}（${index}/${total}）`);
      });
      const summary = summarizeGitWorkspaceSyncResults(results);
      onAfterSync?.();

      if (summary.failed.length > 0) {
        const detail = summary.failed.map((item) => `${item.name}：${item.error ?? "未知错误"}`).join("；");
        message.error(`部分仓库提交推送失败：${detail}`);
        return;
      }

      if (summary.committedCount === 0) {
        message.info("工作区内没有可提交的改动");
        setOpen(false);
        return;
      }

      message.success(
        summary.skippedCount > 0
          ? `已提交并推送 ${summary.committedCount} 个仓库，${summary.skippedCount} 个仓库无改动已跳过`
          : `已提交并推送 ${summary.committedCount} 个仓库`,
      );
      setOpen(false);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`工作区提交推送失败：${errMsg}`);
    } finally {
      setSubmitting(false);
      setProgressLabel("");
    }
  }, [draft, onAfterSync, repositoryEntries]);

  if (repositoryEntries.length === 0) {
    return null;
  }

  const canSubmit = draft.trim().length > 0 && !loadingDraft && !submitting;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      classNames={{ root: "git-workspace-sync-popover" }}
      content={
        <div className="git-workspace-sync-popover__content">
          <div className="git-workspace-sync-popover__title">工作区提交并推送</div>
          <div className="git-workspace-sync-popover__meta">
            {loadingDraft
              ? "正在读取各仓库改动..."
              : dirtyRepoCount > 0
                ? `${dirtyRepoCount} 个仓库有改动，将使用同一提交信息`
                : "当前工作区暂无可提交改动"}
          </div>
          {loadingDraft ? (
            <div className="git-workspace-sync-popover__loading">
              <Spin size="small" />
            </div>
          ) : null}
          <TextArea
            className="git-workspace-sync-popover__textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="提交信息..."
            disabled={loadingDraft || submitting}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          {progressLabel ? (
            <div className="git-workspace-sync-popover__progress">{progressLabel}</div>
          ) : null}
          <div className="git-workspace-sync-popover__footer">
            <Button
              type="primary"
              size="small"
              loading={submitting}
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "提交推送中..." : "提交并推送全部"}
            </Button>
          </div>
        </div>
      }
    >
      <Tooltip title="工作区提交并推送" placement="top">
        <Button
          type="text"
          size="small"
          className="git-workspace-sync-btn"
          icon={<CloudUploadOutlined />}
          aria-label="工作区提交并推送"
          disabled={submitting}
        />
      </Tooltip>
    </Popover>
  );
}
