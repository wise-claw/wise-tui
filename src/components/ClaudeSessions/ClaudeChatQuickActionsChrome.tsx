import { CloudUploadOutlined } from "@ant-design/icons";
import { Spin, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGitRepositoryStats } from "../../hooks/useGitRepositoryStats";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import { commitPullPushRepository } from "../../services/gitCommitPullPush";
import { gitStatus } from "../../services/git";
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

  const [pushSubmitting, setPushSubmitting] = useState(false);
  const [pushSubmitPhase, setPushSubmitPhase] = useState("");
  const pushSubmitInFlightRef = useRef(false);
  const pushAutoFixTimerRef = useRef<number | null>(null);

  useEffect(() => {
    prevGitStatsForPulseRef.current = { additions: 0, deletions: 0 };
    setReviewGitStatsPulse(false);
    pushSubmitInFlightRef.current = false;
    setPushSubmitting(false);
    setPushSubmitPhase("");
    if (pushAutoFixTimerRef.current != null) {
      window.clearTimeout(pushAutoFixTimerRef.current);
      pushAutoFixTimerRef.current = null;
    }
  }, [sessionId]);

  useEffect(
    () => () => {
      if (pushAutoFixTimerRef.current != null) {
        window.clearTimeout(pushAutoFixTimerRef.current);
        pushAutoFixTimerRef.current = null;
      }
    },
    [],
  );

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

  const handlePush = useCallback(async () => {
    if (pushSubmitInFlightRef.current) return;
    const repoPath = gitRepositoryPath;
    if (!repoPath) {
      message.error("当前会话未绑定仓库，无法推送");
      return;
    }

    pushSubmitInFlightRef.current = true;
    setPushSubmitting(true);
    setPushSubmitPhase("读取变更");
    try {
      // 1. 读取变更并 AI 生成提交信息（失败回退到规则生成，不阻断流程）
      const status = await gitStatus(repoPath);
      const fallback = buildAiCommitSummary(status);
      let commitMessage = normalizeConventionalCommitMessage(fallback);

      const changedFiles = [...status.staged, ...status.unstaged];
      if (changedFiles.length > 0) {
        setPushSubmitPhase("AI 润色");
        const changedFileLines = changedFiles
          .map((item) => `- ${item.path} (${item.status}, +${item.additions}, -${item.deletions})`)
          .join("\n");
        const prompt = [
          ...conventionalCommitPromptLines(),
          "",
          `仓库路径: ${repoPath}`,
          `分支: ${status.branch ?? "(unknown)"}`,
          `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
          `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
          "文件清单：",
          changedFileLines || "- 无",
        ].join("\n");
        const configuredModel = await getClaudeConfigModel(repoPath);

        const result = await executeClaudeCodeAndWait({
          repositoryPath: repoPath,
          prompt,
          model: configuredModel ?? undefined,
          timeoutMs: 45_000,
          connectionMode: "oneshot",
        });
        if (result.success) {
          const cleaned = extractClaudeInvocationFinalText(result.outputLines);
          commitMessage = normalizeConventionalCommitMessage(cleaned || fallback);
        }
      }

      // 2. 暂存 + 提交 + 拉取 + 推送（一体化）
      setPushSubmitPhase("提交并推送");
      const outcome = await commitPullPushRepository(repoPath, commitMessage, {
        onPhase: setPushSubmitPhase,
      });
      if (outcome === "noop") {
        message.info("当前没有可提交的改动，也没有待推送的提交");
      } else {
        refreshGitRepositoryStats(repoPath);
        message.success(outcome === "pushed_only" ? "已推送待同步提交" : "已提交并推送");
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`推送失败: ${errMsg}`);
      const dispatchAutoFix = onDispatchExecutionEnvironment;
      if (pushAutoFixTimerRef.current != null) {
        window.clearTimeout(pushAutoFixTimerRef.current);
      }
      pushAutoFixTimerRef.current = window.setTimeout(() => {
        pushAutoFixTimerRef.current = null;
        void (async () => {
          try {
            const latest = await gitStatus(repoPath).catch(() => null);
            const stagedFiles =
              latest?.staged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
            const unstagedFiles =
              latest?.unstaged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
            const autoFixPrompt = [
              "下面是一次 git 提交/同步/推送流程失败日志，请直接定位问题并修改代码后再次验证。",
              "优先处理 pre-commit、husky、lint、typecheck 或测试失败。",
              "",
              `仓库路径：${repoPath}`,
              `分支：${latest?.branch ?? "unknown"}`,
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
      setPushSubmitPhase("");
    }
  }, [gitRepositoryPath, onDispatchExecutionEnvironment]);

  const pushControl = (
    <button
      type="button"
      className="app-session-quick-pill app-session-quick-pill--push"
      disabled={pushSubmitting}
      aria-busy={pushSubmitting}
      title={pushSubmitting ? pushSubmitPhase || "推送中" : "拉取 / AI 生成提交信息 / 提交 / 推送"}
      onPointerDown={(event) => {
        if (event.button !== 0 || pushSubmitting) return;
        event.preventDefault();
        void handlePush();
      }}
    >
      <span className="app-session-quick-pill__icon app-session-quick-pill__icon--green" aria-hidden>
        {pushSubmitting ? <Spin size="small" /> : <CloudUploadOutlined />}
      </span>
      <span className="app-session-quick-pill__label">{pushSubmitting ? pushSubmitPhase || "推送中" : "推送"}</span>
      <span
        className={`app-session-quick-pill__stats${reviewGitStatsPulse ? " app-session-quick-pill__stats--pulse" : ""}`}
      >
        <span className="app-session-quick-pill__add">+{stats.additions}</span>
        <span className="app-session-quick-pill__del">-{stats.deletions}</span>
      </span>
    </button>
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
