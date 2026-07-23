import { CloudUploadOutlined } from "@ant-design/icons";
import { Spin, message } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES } from "../../constants/executionEnvironmentDispatch";
import { filterComposerCommonPhrasesForQuickBar } from "../../constants/composerCommonPhrase";
import { dispatchApplyComposerCommonPhrase } from "../../constants/composerCommonPhraseEvents";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { useGitRepositoryStats } from "../../hooks/useGitRepositoryStats";
import { gitStatus } from "../../services/git";
import { aiCommitPullPushRepository, isGitMergeConflictError } from "../../services/gitCommitPullPush";
import { refreshGitRepositoryStats } from "../../stores/gitRepositoryStatsStore";
import { ComposerCommonPhrasesBar } from "../ClaudeChatInput/ComposerCommonPhrasesBar";
import { SessionQuickActionsBar } from "./SessionQuickActionsBar";

export interface ClaudeChatQuickActionsChromeProps {
  sessionId: string;
  gitRepositoryPath: string;
  /** 当前会话所属仓库 id；提供时常用语走「仓库优先 + 全局兜底」，多屏下各 pane 显示各自仓库的。 */
  repositoryId?: number | null;
  /** 当前会话执行引擎；AI 润色提交信息走该引擎。 */
  executionEngine?: SessionExecutionEngine;
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
  repositoryId,
  executionEngine,
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  onDispatchExecutionEnvironment,
  composerSessionBusyWithoutEnqueue = false,
}: ClaudeChatQuickActionsChromeProps) {
  const { phrases: composerCommonPhrases } = useComposerCommonPhrases({ repositoryId });
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
      // AI 生成提交信息 + 暂存 + 提交 + 拉取 + 推送（一体化，phase 由 service 经 onPhase 推进）
      const outcome = await aiCommitPullPushRepository(repoPath, {
        onPhase: setPushSubmitPhase,
        executionEngine,
      });
      if (outcome === "noop") {
        message.info("当前没有可提交的改动，也没有待推送的提交");
      } else {
        refreshGitRepositoryStats(repoPath);
        message.success(outcome === "pushed_only" ? "已推送待同步提交" : "已提交并推送");
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // pull/merge 冲突：AI 无法解决语义冲突，提示用户手动处理，不派发 autoFix
      if (isGitMergeConflictError(errMsg)) {
        message.warning("拉取/合并存在冲突，请手动解决冲突后重试推送");
        refreshGitRepositoryStats(repoPath);
      } else {
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
      }
    } finally {
      pushSubmitInFlightRef.current = false;
      setPushSubmitting(false);
      setPushSubmitPhase("");
    }
  }, [executionEngine, gitRepositoryPath, onDispatchExecutionEnvironment]);

  const ahead = stats.ahead ?? 0;
  const behind = stats.behind ?? 0;
  const hasSyncCount = ahead > 0 || behind > 0;
  const idleTitle = [
    "拉取 / AI 生成提交信息 / 提交 / 推送",
    ahead > 0 ? `领先 ${ahead} 个提交` : null,
    behind > 0 ? `落后 ${behind} 个提交` : null,
    `工作区 +${stats.additions} / -${stats.deletions}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const pushControl = (
    <button
      type="button"
      className="app-session-quick-pill app-session-quick-pill--push"
      disabled={pushSubmitting}
      aria-busy={pushSubmitting}
      aria-label={
        pushSubmitting
          ? pushSubmitPhase || "推送中"
          : ahead > 0
            ? `推送，领先 ${ahead} 个提交${behind > 0 ? `，落后 ${behind}` : ""}`
            : "推送"
      }
      title={pushSubmitting ? pushSubmitPhase || "推送中" : idleTitle}
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
        {hasSyncCount ? (
          <>
            {ahead > 0 ? <span className="app-session-quick-pill__ahead">↑{ahead}</span> : null}
            {behind > 0 ? <span className="app-session-quick-pill__behind">↓{behind}</span> : null}
          </>
        ) : (
          <>
            <span className="app-session-quick-pill__add">+{stats.additions}</span>
            <span className="app-session-quick-pill__del">-{stats.deletions}</span>
          </>
        )}
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
