import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Popover, Spin, message } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import {
  commitAndPushWorkspaceRepositories,
  summarizeGitWorkspaceSyncResults,
  type GitWorkspaceRepositoryRef,
} from "../../services/gitWorkspaceSync";
import { gitStatusSummary } from "../../services/git";
import { needsGitSyncWorkFromSummary } from "../../services/gitCommitPullPush";
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
  const [aheadOnlyRepoCount, setAheadOnlyRepoCount] = useState(0);
  const loadSeqRef = useRef(0);
  const draftRef = useRef(draft);
  const submitLockRef = useRef(false);
  draftRef.current = draft;

  const loadDirtyRepoCount = useCallback(async (seq: number) => {
    if (repositoryEntries.length === 0) return;
    setLoadingDraft(true);
    setProgressLabel("");
    try {
      const refs: GitWorkspaceRepositoryRef[] = repositoryEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
      }));
      const summaries = await Promise.all(
        refs.map(async (entry) => {
          try {
            return await gitStatusSummary(entry.path);
          } catch {
            return null;
          }
        }),
      );
      if (seq !== loadSeqRef.current) return;
      let dirty = 0;
      let aheadOnly = 0;
      for (const summary of summaries) {
        if (!summary || !needsGitSyncWorkFromSummary(summary)) continue;
        if (summary.stagedCount > 0 || summary.unstagedCount > 0) {
          dirty += 1;
        } else if ((summary.ahead ?? 0) > 0) {
          aheadOnly += 1;
        }
      }
      setDirtyRepoCount(dirty);
      setAheadOnlyRepoCount(aheadOnly);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setDirtyRepoCount(0);
      setAheadOnlyRepoCount(0);
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
      if (!nextOpen && submitting) return;
      setOpen(nextOpen);
      if (!nextOpen) {
        loadSeqRef.current += 1;
        setLoadingDraft(false);
        setProgressLabel("");
        setDraft("");
        setDirtyRepoCount(0);
        setAheadOnlyRepoCount(0);
        return;
      }
      setDraft("");
      setProgressLabel("");
      loadSeqRef.current += 1;
      const seq = loadSeqRef.current;
      void loadDirtyRepoCount(seq);
    },
    [loadDirtyRepoCount, submitting],
  );

  useEffect(
    () => () => {
      loadSeqRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!submitting) {
      submitLockRef.current = false;
    }
  }, [submitting]);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitLockRef.current) return;
    const commitMessage = draftRef.current.trim();
    if (!commitMessage) {
      message.warning("请先填写提交信息");
      return;
    }
    if (repositoryEntries.length === 0) {
      message.warning("当前工作区没有可提交的仓库");
      return;
    }

    submitLockRef.current = true;

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

      if (summary.committedCount === 0 && summary.pushedOnlyCount === 0) {
        message.info("工作区内没有可提交或推送的内容");
        setOpen(false);
        return;
      }

      if (summary.pushedOnlyCount > 0 && summary.committedCount === 0) {
        message.success(`已推送 ${summary.pushedOnlyCount} 个仓库的待推送提交`);
      } else if (summary.committedCount > 0) {
        message.success(`已提交并推送 ${summary.committedCount} 个仓库`);
      }

      setOpen(false);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`工作区提交推送失败：${errMsg}`);
    } finally {
      setSubmitting(false);
      setProgressLabel("");
    }
  }, [onAfterSync, repositoryEntries, submitting]);

  if (repositoryEntries.length === 0) {
    return null;
  }

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      destroyOnHidden
      classNames={{ root: "git-workspace-sync-popover" }}
      content={
        <form
          className="git-workspace-sync-popover__content"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="git-workspace-sync-popover__title">工作区提交并推送</div>
          <div className="git-workspace-sync-popover__meta">
            {loadingDraft
              ? "正在读取各仓库改动..."
              : dirtyRepoCount > 0
                ? `${dirtyRepoCount} 个仓库有改动，将使用同一提交信息`
                : aheadOnlyRepoCount > 0
                  ? `${aheadOnlyRepoCount} 个仓库仅有待推送提交，将直接拉取并推送`
                  : "当前工作区暂无可同步内容"}
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
            disabled={submitting}
            autoSize={{ minRows: 3, maxRows: 6 }}
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if (!event.metaKey && !event.ctrlKey) return;
              event.preventDefault();
              void handleSubmit();
            }}
          />
          {progressLabel ? (
            <div className="git-workspace-sync-popover__progress">{progressLabel}</div>
          ) : null}
          <div className="git-workspace-sync-popover__footer">
            <Button
              htmlType="button"
              type="primary"
              size="small"
              loading={submitting}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (event.button !== 0 || submitting) return;
                event.preventDefault();
                void handleSubmit();
              }}
            >
              {submitting ? "提交推送中..." : "提交并推送全部"}
            </Button>
          </div>
        </form>
      }
    >
      <Button
        type="text"
        size="small"
        className="git-workspace-sync-btn"
        icon={<CloudUploadOutlined />}
        aria-label="工作区提交并推送"
        title="工作区提交并推送"
        disabled={submitting}
      />
    </Popover>
  );
}
