import { CloudUploadOutlined } from "@ant-design/icons";
import { Button, Empty, Modal, Popover, Popconfirm, Spin, Tooltip, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED } from "../../constants/workflowUiEvents";
import type { RepoWorktreesMayHaveChangedDetail } from "../../constants/workflowUiEvents";
import { useGitRepositoryStats } from "../../hooks/useGitRepositoryStats";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import {
  gitCommit,
  gitPull,
  gitPush,
  gitStageAll,
  gitStatus,
  gitWorktreeList,
  gitWorktreeRemove,
} from "../../services/git";
import { openInFinder } from "../../services/repository";
import { refreshGitRepositoryStats } from "../../stores/gitRepositoryStatsStore";
import type { GitWorktreeEntry } from "../../types";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import {
  buildAiCommitSummary,
  formatWorktreeBranchLabel,
  formatWorktreePathRelative,
  sessionRepoPathKey,
} from "./claudeChatHelpers";
import { filterComposerCommonPhrasesForQuickBar } from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { SessionQuickActionsBar } from "./SessionQuickActionsBar";

export interface ClaudeChatQuickActionsChromeProps {
  sessionId: string;
  gitRepositoryPath: string;
  sessionRepositoryPath: string;
  onCreateNewSession?: () => void;
  creatingNewSession?: boolean;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onOpenWorkTrajectory: () => void;
  onSend?: (prompt: string) => void;
  onAddWorktreeRepositoryToProject?: (worktreePath: string) => void | Promise<void>;
  /** 与输入区一致：会话忙且无法入队时禁用「直接发送」类常用语 */
  composerSessionBusyWithoutEnqueue?: boolean;
}

export const ClaudeChatQuickActionsChrome = memo(function ClaudeChatQuickActionsChrome({
  sessionId,
  gitRepositoryPath,
  sessionRepositoryPath,
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onOpenWorkTrajectory,
  onSend,
  onAddWorktreeRepositoryToProject,
  composerSessionBusyWithoutEnqueue = false,
}: ClaudeChatQuickActionsChromeProps) {
  const { phrases: composerCommonPhrases } = useComposerCommonPhrases();
  const applyCommonPhrase = useCallback(
    (phrase: Parameters<typeof dispatchApplyComposerCommonPhrase>[1]) => {
      dispatchApplyComposerCommonPhrase(sessionId, phrase);
    },
    [sessionId],
  );
  const quickBarPhrases = useMemo(
    () => filterComposerCommonPhrasesForQuickBar(composerCommonPhrases),
    [composerCommonPhrases],
  );
  const commonPhrasesSlot = useMemo(
    () =>
      quickBarPhrases.length > 0 ? (
        <ComposerCommonPhrasesBar
          variant="quickBar"
          phrases={quickBarPhrases}
          sessionBusyWithoutEnqueue={composerSessionBusyWithoutEnqueue}
          onApplyPhrase={applyCommonPhrase}
        />
      ) : null,
    [applyCommonPhrase, quickBarPhrases, composerSessionBusyWithoutEnqueue],
  );
  const stats = useGitRepositoryStats(gitRepositoryPath);
  const [reviewGitStatsPulse, setReviewGitStatsPulse] = useState(false);
  const prevGitStatsForPulseRef = useRef({ additions: 0, deletions: 0 });

  const [pushPopoverOpen, setPushPopoverOpen] = useState(false);
  const [pushSummaryDraft, setPushSummaryDraft] = useState("");
  const [pushSummaryLoading, setPushSummaryLoading] = useState(false);
  const [pushSummaryPhase, setPushSummaryPhase] = useState("");
  const [pushSubmitting, setPushSubmitting] = useState(false);
  const pushSummaryLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushSummaryLoadSeqRef = useRef(0);
  const pushAutoFixTimerRef = useRef<number | null>(null);
  const gitWorktreeLoadSeqRef = useRef(0);
  const pushSubmitInFlightRef = useRef(false);

  const [gitWorktreePopoverOpen, setGitWorktreePopoverOpen] = useState(false);
  const [linkedWorktrees, setLinkedWorktrees] = useState<GitWorktreeEntry[]>([]);
  const [gitWorktreeLoading, setGitWorktreeLoading] = useState(false);
  const [gitWorktreeRemovingPath, setGitWorktreeRemovingPath] = useState<string | null>(null);
  const [gitWorktreeAddingToProjectPath, setGitWorktreeAddingToProjectPath] = useState<string | null>(null);

  useEffect(() => {
    prevGitStatsForPulseRef.current = { additions: 0, deletions: 0 };
    setReviewGitStatsPulse(false);
    setPushPopoverOpen(false);
    setPushSummaryDraft("");
    setPushSummaryLoading(false);
    setPushSummaryPhase("");
    setGitWorktreePopoverOpen(false);
    pushSummaryLoadSeqRef.current += 1;
    gitWorktreeLoadSeqRef.current += 1;
    if (pushAutoFixTimerRef.current != null) {
      window.clearTimeout(pushAutoFixTimerRef.current);
      pushAutoFixTimerRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    const prev = prevGitStatsForPulseRef.current;
    const additionsIncreased = stats.additions > prev.additions && prev.additions > 0;
    const deletionsIncreased = stats.deletions > prev.deletions && prev.deletions > 0;
    prevGitStatsForPulseRef.current = { additions: stats.additions, deletions: stats.deletions };
    if (!additionsIncreased && !deletionsIncreased) {
      return;
    }
    setReviewGitStatsPulse(true);
    const t = window.setTimeout(() => setReviewGitStatsPulse(false), 480);
    return () => window.clearTimeout(t);
  }, [stats.additions, stats.deletions]);

  const cancelScheduledPushSummaryLoad = useCallback(() => {
    if (pushSummaryLoadTimerRef.current != null) {
      clearTimeout(pushSummaryLoadTimerRef.current);
      pushSummaryLoadTimerRef.current = null;
    }
  }, []);

  const loadPushSummaryDraft = useCallback(
    async (seq: number) => {
      if (!gitRepositoryPath) return;

      setPushSummaryLoading(true);
      setPushSummaryPhase("读取 Git 变更中...");

      let status: Awaited<ReturnType<typeof gitStatus>> | null = null;
      try {
        status = await gitStatus(gitRepositoryPath);
        if (seq !== pushSummaryLoadSeqRef.current) return;
        setPushSummaryDraft(buildAiCommitSummary(status));
      } catch {
        if (seq !== pushSummaryLoadSeqRef.current) return;
        setPushSummaryDraft("");
        setPushSummaryLoading(false);
        setPushSummaryPhase("");
        return;
      }

      setPushSummaryLoading(false);
      setPushSummaryPhase("AI 润色中（后台）...");
      try {
        const fallback = buildAiCommitSummary(status);
        const changedFiles = [...status.staged, ...status.unstaged]
          .map((item) => `- ${item.path} (${item.status}, +${item.additions}, -${item.deletions})`)
          .join("\n");
        const prompt = [
          "你是资深工程师，请基于以下 git 改动生成一段简洁的中文提交总结草稿。",
          "要求：",
          "1) 2-4 行；",
          "2) 第一行说明本次改动目标；",
          "3) 后续行按要点概述影响范围；",
          "4) 不要使用 markdown 标题，不要输出解释。",
          "",
          `仓库路径: ${gitRepositoryPath}`,
          `分支: ${status.branch ?? "(unknown)"}`,
          `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
          "文件清单：",
          changedFiles || "- 无",
          "",
          "请仅输出最终提交总结正文。",
        ].join("\n");
        const configuredModel = await getClaudeConfigModel(gitRepositoryPath);
        if (seq !== pushSummaryLoadSeqRef.current) return;

        const result = await executeClaudeCodeAndWait({
          repositoryPath: gitRepositoryPath,
          prompt,
          model: configuredModel ?? undefined,
          timeoutMs: 45_000,
          connectionMode: "oneshot",
        });
        if (seq !== pushSummaryLoadSeqRef.current) return;

        if (!result.success) {
          setPushSummaryDraft(fallback);
          return;
        }
        const cleaned = extractClaudeInvocationFinalText(result.outputLines);
        setPushSummaryDraft(cleaned || fallback);
      } catch {
        if (seq !== pushSummaryLoadSeqRef.current) return;
        setPushSummaryPhase("AI 润色失败，已保留本地模板");
      } finally {
        if (seq === pushSummaryLoadSeqRef.current) {
          setPushSummaryPhase("");
        }
      }
    },
    [gitRepositoryPath],
  );

  const schedulePushSummaryLoad = useCallback(() => {
    cancelScheduledPushSummaryLoad();
    pushSummaryLoadSeqRef.current += 1;
    const seq = pushSummaryLoadSeqRef.current;
    pushSummaryLoadTimerRef.current = setTimeout(() => {
      pushSummaryLoadTimerRef.current = null;
      void loadPushSummaryDraft(seq);
    }, 350);
  }, [cancelScheduledPushSummaryLoad, loadPushSummaryDraft]);

  const handlePushPopoverOpenChange = useCallback(
    (open: boolean) => {
      setPushPopoverOpen(open);
      if (!open) {
        cancelScheduledPushSummaryLoad();
        pushSummaryLoadSeqRef.current += 1;
        return;
      }
      schedulePushSummaryLoad();
    },
    [cancelScheduledPushSummaryLoad, schedulePushSummaryLoad],
  );

  useEffect(
    () => () => {
      cancelScheduledPushSummaryLoad();
      if (pushAutoFixTimerRef.current != null) {
        window.clearTimeout(pushAutoFixTimerRef.current);
        pushAutoFixTimerRef.current = null;
      }
    },
    [cancelScheduledPushSummaryLoad],
  );

  const handlePushSubmit = useCallback(async () => {
    if (pushSubmitInFlightRef.current) return;
    const repoPath = gitRepositoryPath;
    const commitMessage = pushSummaryDraft.trim();
    if (!repoPath) {
      message.error("当前会话未绑定仓库，无法推送");
      return;
    }
    if (!commitMessage) {
      message.warning("请先填写提交总结");
      return;
    }

    pushSubmitInFlightRef.current = true;
    setPushSubmitting(true);
    try {
      const latestStatus = await gitStatus(repoPath);
      if (latestStatus.staged.length === 0 && latestStatus.unstaged.length === 0) {
        message.info("当前没有可提交的改动");
        setPushPopoverOpen(false);
        return;
      }
      if (latestStatus.unstaged.length > 0) {
        await gitStageAll(repoPath);
      }
      await gitCommit(repoPath, commitMessage);
      await gitPull(repoPath);
      await gitPush(repoPath);
      setPushPopoverOpen(false);
      refreshGitRepositoryStats(repoPath);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`推送失败: ${errMsg}`);
      const repoPathForFix = repoPath;
      const commitMessageForFix = commitMessage;
      const sendAutoFix = onSend;
      if (pushAutoFixTimerRef.current != null) {
        window.clearTimeout(pushAutoFixTimerRef.current);
      }
      pushAutoFixTimerRef.current = window.setTimeout(() => {
        pushAutoFixTimerRef.current = null;
        void (async () => {
          try {
            const latest = await gitStatus(repoPathForFix).catch(() => null);
            const stagedFiles =
              latest?.staged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
            const unstagedFiles =
              latest?.unstaged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
            const autoFixPrompt = [
              "下面是一次 git 提交/同步/推送流程失败日志，请直接定位问题并修改代码后再次验证。",
              "优先处理 pre-commit、husky、lint、typecheck 或测试失败。",
              "",
              `仓库路径：${repoPathForFix}`,
              `分支：${latest?.branch ?? "unknown"}`,
              `提交信息：${commitMessageForFix}`,
              `变更统计：+${Math.max(0, latest?.additions || 0)} / -${Math.max(0, latest?.deletions || 0)}`,
              `暂存文件：${stagedFiles.length > 0 ? stagedFiles.join("、") : "(无)"}`,
              `未暂存文件：${unstagedFiles.length > 0 ? unstagedFiles.join("、") : "(无)"}`,
              "",
              "失败日志：",
              "```text",
              errMsg,
              "```",
              "",
              "请输出并执行修复步骤，完成后给出简短结果说明。",
            ].join("\n");
            sendAutoFix?.(autoFixPrompt);
            message.info("已将失败日志交给 Claude Code 自动修复。");
          } catch {
            /* ignore auto-fix dispatch failure */
          }
        })();
      }, 0);
    } finally {
      pushSubmitInFlightRef.current = false;
      setPushSubmitting(false);
    }
  }, [gitRepositoryPath, onSend, pushSummaryDraft]);

  const loadLinkedWorktrees = useCallback(async () => {
    const p = gitRepositoryPath;
    if (!p) {
      setLinkedWorktrees([]);
      return;
    }
    const seq = ++gitWorktreeLoadSeqRef.current;
    setGitWorktreeLoading(true);
    try {
      const list = await gitWorktreeList(p);
      if (seq !== gitWorktreeLoadSeqRef.current) return;
      const extras = list.filter((w) => !w.isPrimary);
      const seen = new Set<string>();
      const deduped: GitWorktreeEntry[] = [];
      for (const w of extras) {
        const key = sessionRepoPathKey(w.path);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(w);
      }
      setLinkedWorktrees(deduped);
    } finally {
      if (seq === gitWorktreeLoadSeqRef.current) {
        setGitWorktreeLoading(false);
      }
    }
  }, [gitRepositoryPath]);

  useEffect(() => {
    void loadLinkedWorktrees();
  }, [loadLinkedWorktrees]);

  useEffect(() => {
    const onRepoWorktreesMayHaveChanged = (ev: Event): void => {
      const detail = (ev as CustomEvent<RepoWorktreesMayHaveChangedDetail>).detail;
      const anchor = gitRepositoryPath;
      const changed = detail?.repositoryPath?.trim();
      if (!anchor || !changed) return;
      if (sessionRepoPathKey(anchor) !== sessionRepoPathKey(changed)) return;
      void loadLinkedWorktrees();
    };
    window.addEventListener(WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED, onRepoWorktreesMayHaveChanged);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED, onRepoWorktreesMayHaveChanged);
    };
  }, [gitRepositoryPath, loadLinkedWorktrees]);

  const handleOpenWorktreeMenu = useCallback(() => {
    setGitWorktreePopoverOpen(true);
    void loadLinkedWorktrees();
  }, [loadLinkedWorktrees]);

  const handleGitWorktreeRemove = useCallback(
    async (worktreePath: string) => {
      const p = gitRepositoryPath;
      if (!p) return;
      setGitWorktreeRemovingPath(worktreePath);
      try {
        await gitWorktreeRemove(p, worktreePath);
        message.success("已移除 worktree");
        await loadLinkedWorktrees();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(errMsg);
      } finally {
        setGitWorktreeRemovingPath(null);
      }
    },
    [gitRepositoryPath, loadLinkedWorktrees],
  );

  const handleOpenWorktreeInFinder = useCallback((worktreePath: string) => {
    void openInFinder(worktreePath).catch((err) => {
      console.error("openInFinder:", err);
      message.error(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const handleAddWorktreeToProject = useCallback(
    async (worktreePath: string) => {
      if (!onAddWorktreeRepositoryToProject) return;
      setGitWorktreeAddingToProjectPath(worktreePath);
      try {
        await onAddWorktreeRepositoryToProject(worktreePath);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        setGitWorktreeAddingToProjectPath(null);
      }
    },
    [onAddWorktreeRepositoryToProject],
  );

  const pushControl = (
    <Popover
      trigger="click"
      placement="topLeft"
      open={pushPopoverOpen}
      onOpenChange={handlePushPopoverOpenChange}
      classNames={{ root: "app-push-popover" }}
      content={
        <div className="app-push-popover__content">
          <div className="app-push-popover__title">推送前提交总结（AI 生成草稿）</div>
          {pushSummaryPhase ? (
            <div className="app-push-popover__loading">
              {pushSummaryLoading ? <Spin size="small" /> : null}
              <span>{pushSummaryPhase}</span>
            </div>
          ) : null}
          <textarea
            className="app-push-popover__textarea"
            value={pushSummaryDraft}
            onChange={(event) => setPushSummaryDraft(event.target.value)}
            placeholder="提交总结..."
            disabled={pushSubmitting}
          />
          <div className="app-push-popover__footer">
            <button
              type="button"
              className="app-push-popover__submit"
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (event.button !== 0 || pushSubmitting) return;
                event.preventDefault();
                void handlePushSubmit();
              }}
              disabled={pushSubmitting}
            >
              {pushSubmitting ? "推送中..." : "推送"}
            </button>
          </div>
        </div>
      }
    >
      <button
        type="button"
        className="app-session-quick-pill app-session-quick-pill--push"
        disabled={pushSubmitting}
        aria-busy={pushSubmitting}
      >
        <span className="app-session-quick-pill__icon app-session-quick-pill__icon--green" aria-hidden>
          <CloudUploadOutlined />
        </span>
        <span className="app-session-quick-pill__label">推送</span>
        <span
          className={`app-session-quick-pill__stats${reviewGitStatsPulse ? " app-session-quick-pill__stats--pulse" : ""}`}
        >
          <span className="app-session-quick-pill__add">+{stats.additions}</span>
          <span className="app-session-quick-pill__del">-{stats.deletions}</span>
        </span>
      </button>
    </Popover>
  );

  return (
    <>
      <SessionQuickActionsBar
        onCreateNewSession={onCreateNewSession}
        creatingNewSession={creatingNewSession}
        onOpenBuiltinAssistant={onOpenBuiltinAssistant}
        onOpenWorkTrajectory={onOpenWorkTrajectory}
        showWorktreeInMore={Boolean(sessionRepositoryPath)}
        onOpenWorktreeMenu={handleOpenWorktreeMenu}
        pushControl={pushControl}
        commonPhrasesSlot={commonPhrasesSlot}
      />

      {sessionRepositoryPath ? (
        <Modal
          title="本仓库额外 worktree"
          open={gitWorktreePopoverOpen}
          onCancel={() => setGitWorktreePopoverOpen(false)}
          footer={null}
          width={520}
          destroyOnHidden
          className="app-gitworktree-modal"
        >
          <div className="app-gitworktree-popover__content">
            {gitWorktreeLoading ? (
              <div className="app-gitworktree-popover__loading">
                <Spin size="small" />
                <span>加载中...</span>
              </div>
            ) : linkedWorktrees.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无额外 worktree" />
            ) : (
              <ul className="app-gitworktree-popover__list">
                {linkedWorktrees.map((w) => (
                  <li key={w.path} className="app-gitworktree-popover__item">
                    <div className="app-gitworktree-popover__item-main">
                      <div className="app-gitworktree-popover__branch">{formatWorktreeBranchLabel(w.branch)}</div>
                      <div className="app-gitworktree-popover__path" title={w.path}>
                        {formatWorktreePathRelative(sessionRepositoryPath, w.path)}
                      </div>
                    </div>
                    <div className="app-gitworktree-popover__item-actions">
                      <Tooltip title="在系统文件管理器中打开此目录">
                        <Button type="link" size="small" onClick={() => handleOpenWorktreeInFinder(w.path)}>
                          打开目录
                        </Button>
                      </Tooltip>
                      {onAddWorktreeRepositoryToProject ? (
                        <Tooltip title="加入左侧当前项目，便于在仓库列表中切换">
                          <Button
                            type="link"
                            size="small"
                            loading={gitWorktreeAddingToProjectPath === w.path}
                            disabled={
                              (gitWorktreeAddingToProjectPath !== null &&
                                gitWorktreeAddingToProjectPath !== w.path) ||
                              (gitWorktreeRemovingPath !== null && gitWorktreeRemovingPath !== w.path)
                            }
                            onClick={() => void handleAddWorktreeToProject(w.path)}
                          >
                            加入项目
                          </Button>
                        </Tooltip>
                      ) : null}
                      <Popconfirm
                        title="撤回此 worktree？"
                        description="将执行 git worktree remove --force，并删除该 worktree 对应的工作区目录。"
                        okText="确定"
                        cancelText="取消"
                        styles={{ container: { width: "min(92vw, 300px)", maxWidth: "min(92vw, 300px)" } }}
                        onConfirm={() => void handleGitWorktreeRemove(w.path)}
                      >
                        <Button
                          type="link"
                          size="small"
                          danger
                          loading={gitWorktreeRemovingPath === w.path}
                          disabled={
                            (gitWorktreeRemovingPath !== null && gitWorktreeRemovingPath !== w.path) ||
                            (gitWorktreeAddingToProjectPath !== null &&
                              gitWorktreeAddingToProjectPath !== w.path)
                          }
                        >
                          撤销
                        </Button>
                      </Popconfirm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
});
