import { CloudUploadOutlined } from "@ant-design/icons";
import { Popover, Spin, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGitRepositoryStats } from "../../hooks/useGitRepositoryStats";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import { gitCommit, gitPull, gitPush, gitStageAll, gitStatus } from "../../services/git";
import { refreshGitRepositoryStats } from "../../stores/gitRepositoryStatsStore";
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import { EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES } from "../../constants/executionEnvironmentDispatch";
import { buildAiCommitSummary } from "./claudeChatHelpers";
import {
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
} from "../../utils/conventionalCommitMessage";
import { filterComposerCommonPhrasesForQuickBar } from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { SessionQuickActionsBar } from "./SessionQuickActionsBar";

export interface ClaudeChatQuickActionsChromeProps {
  sessionId: string;
  gitRepositoryPath: string;
  onCreateNewSession?: () => void;
  creatingNewSession?: boolean;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  onOpenAssistantsHub?: () => void;
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  /** 与输入区一致：会话忙且无法入队时禁用「直接发送」类常用语 */
  composerSessionBusyWithoutEnqueue?: boolean;
}

export const ClaudeChatQuickActionsChrome = memo(function ClaudeChatQuickActionsChrome({
  sessionId,
  gitRepositoryPath,
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  onDispatchExecutionEnvironment,
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
  const pushSubmitInFlightRef = useRef(false);

  useEffect(() => {
    prevGitStatsForPulseRef.current = { additions: 0, deletions: 0 };
    setReviewGitStatsPulse(false);
    setPushPopoverOpen(false);
    setPushSummaryDraft("");
    setPushSummaryLoading(false);
    setPushSummaryPhase("");
    pushSummaryLoadSeqRef.current += 1;
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
          ...conventionalCommitPromptLines(),
          "",
          `仓库路径: ${gitRepositoryPath}`,
          `分支: ${status.branch ?? "(unknown)"}`,
          `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
          "文件清单：",
          changedFiles || "- 无",
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
        setPushSummaryDraft(normalizeConventionalCommitMessage(cleaned || fallback));
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
    const commitMessage = normalizeConventionalCommitMessage(pushSummaryDraft.trim());
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
      const dispatchAutoFix = onDispatchExecutionEnvironment;
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
            if (!dispatchAutoFix) {
              message.warning("无法派发错误检查：执行环境派发未就绪。");
              return;
            }
            const mention = EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES.claude;
            await dispatchAutoFix({
              prompt: `@${mention} ${autoFixPrompt}`,
              userBubblePrompt: "Git 提交/推送失败，排查 pre-commit、lint、typecheck 等问题",
            });
            message.info(`已通过 @${mention} 派发错误检查，主会话不受阻塞。`);
          } catch {
            /* ignore auto-fix dispatch failure */
          }
        })();
      }, 0);
    } finally {
      pushSubmitInFlightRef.current = false;
      setPushSubmitting(false);
    }
  }, [gitRepositoryPath, onDispatchExecutionEnvironment, pushSummaryDraft]);

  const pushSummaryBusy = pushSummaryLoading || Boolean(pushSummaryPhase.trim());

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
                if (event.button !== 0 || pushSubmitting || pushSummaryBusy) return;
                event.preventDefault();
                void handlePushSubmit();
              }}
              disabled={pushSubmitting || pushSummaryBusy}
              aria-busy={pushSubmitting || pushSummaryBusy}
            >
              {pushSubmitting ? "推送中..." : pushSummaryBusy ? "润色中..." : "推送"}
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
    <SessionQuickActionsBar
      onCreateNewSession={onCreateNewSession}
      creatingNewSession={creatingNewSession}
      onOpenBuiltinAssistant={onOpenBuiltinAssistant}
      onActivateAssistant={onActivateAssistant}
      onOpenAssistantsHub={onOpenAssistantsHub}
      pushControl={pushControl}
      commonPhrasesSlot={commonPhrasesSlot}
    />
  );
});
