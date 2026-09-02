import { useState } from "react";
import { Input, Modal, Typography, message } from "antd";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import {
  commitPullPushRepository,
  gitCommitPullPushNoopMessage,
  gitCommitPullPushSuccessMessage,
  isGitMergeConflictError,
  type GitCommitPullPushOutcome,
} from "../../services/gitCommitPullPush";
import {
  generateGitCommitMessageByAi,
  type GenerateGitCommitMessageByAiResult,
} from "../../services/gitCommitMessageAi";
import { gitStatus } from "../../services/git";
import { normalizeConventionalCommitMessage } from "../../utils/conventionalCommitMessage";
import type { GitStatusResponse } from "../../types";
import type { GitSyncActionKind } from "./gitSyncActionRunner";

const { TextArea } = Input;
const { Text } = Typography;

export interface GitCommitDraftHandle {
  getMessage: () => string;
  clear: () => void;
}

export type GitPanelPushCommitResolution =
  | { kind: "generate" }
  | { kind: "push"; message: string; consumeDraft: boolean };

/** 决定顶栏推送是直接推送、复用已填草稿，还是先 AI 生成。 */
export function resolveGitPanelPushCommitMessage(input: {
  needsCommitMessage: boolean;
  draftMessage?: string;
}): GitPanelPushCommitResolution {
  if (!input.needsCommitMessage) {
    return { kind: "push", message: "", consumeDraft: false };
  }
  const draft = input.draftMessage?.trim() ?? "";
  if (draft) {
    return {
      kind: "push",
      message: normalizeConventionalCommitMessage(draft),
      consumeDraft: true,
    };
  }
  return { kind: "generate" };
}

/** AI 生成成功则直接推送；失败才弹窗手填（预填规则兜底文案）。 */
export function resolvePushMessageAfterAi(
  generated: Pick<GenerateGitCommitMessageByAiResult, "message" | "aiFailed">,
): { kind: "push"; message: string } | { kind: "prompt"; initialValue: string } {
  const trimmed = generated.message.trim();
  if (!generated.aiFailed && trimmed) {
    return { kind: "push", message: trimmed };
  }
  return { kind: "prompt", initialValue: trimmed };
}

function CommitMessageForm({
  initialValue,
  hint,
  onChange,
}: {
  initialValue: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="git-commit-message-dialog">
      <Text type="secondary" className="git-commit-message-dialog__hint">
        {hint}
      </Text>
      <TextArea
        autoFocus
        value={value}
        rows={4}
        placeholder="feat: 简述这次改动"
        className="git-commit-message-dialog__textarea"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          if (!event.metaKey && !event.ctrlKey) return;
          event.preventDefault();
          const ok = event.currentTarget
            .closest(".ant-modal")
            ?.querySelector<HTMLButtonElement>(".ant-modal-confirm-btns .ant-btn-primary");
          ok?.click();
        }}
      />
    </div>
  );
}

/** 弹窗手填提交信息；取消或关闭返回 null。 */
export function promptGitCommitMessage(options?: {
  initialValue?: string;
  hint?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let current = options?.initialValue ?? "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Modal.confirm({
      title: "填写提交信息",
      icon: null,
      centered: true,
      maskClosable: true,
      okText: "提交并推送",
      cancelText: "取消",
      className: "git-commit-message-modal",
      content: (
        <CommitMessageForm
          initialValue={current}
          hint={options?.hint ?? "当前有未提交改动，推送前请填写提交信息。"}
          onChange={(next) => {
            current = next;
          }}
        />
      ),
      onOk: () => {
        const trimmed = current.trim();
        if (!trimmed) {
          message.warning("请输入提交信息");
          return Promise.reject(new Error("empty commit message"));
        }
        finish(normalizeConventionalCommitMessage(trimmed));
      },
      onCancel: () => finish(null),
    });
  });
}

export function reportGitPushOutcome(outcome: GitCommitPullPushOutcome): void {
  if (outcome === "noop") {
    message.info(gitCommitPullPushNoopMessage());
    return;
  }
  const successMsg = gitCommitPullPushSuccessMessage(outcome);
  if (successMsg) message.success(successMsg);
}

export function reportGitPushError(errMsg: string): void {
  if (isGitMergeConflictError(errMsg)) {
    message.warning("拉取/合并存在冲突，请手动解决后重试");
    return;
  }
  message.error(`推送失败: ${errMsg}`);
}

export async function startGitPanelPush(options: {
  repositoryPath: string;
  needsCommitMessage: boolean;
  commitDraft?: GitCommitDraftHandle | null;
  executionEngine?: SessionExecutionEngine | null;
  status?: GitStatusResponse | null;
  setPreparing?: (preparing: boolean) => void;
  runGitSync: (
    kind: GitSyncActionKind,
    work: () => Promise<void>,
    onErrorMessage: (msg: string) => void,
  ) => void;
}): Promise<void> {
  let resolution = resolveGitPanelPushCommitMessage({
    needsCommitMessage: options.needsCommitMessage,
    draftMessage: options.commitDraft?.getMessage(),
  });
  if (resolution.kind === "generate") {
    options.setPreparing?.(true);
    let generated: GenerateGitCommitMessageByAiResult = {
      message: "",
      aiFailed: true,
    };
    try {
      const status = options.status ?? (await gitStatus(options.repositoryPath));
      generated = await generateGitCommitMessageByAi({
        repositoryPath: options.repositoryPath,
        status,
        repositoryEngine: options.executionEngine,
      });
    } catch (error) {
      generated = {
        message: "",
        aiFailed: true,
        failureReason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      options.setPreparing?.(false);
    }

    const afterAi = resolvePushMessageAfterAi(generated);
    if (afterAi.kind === "push") {
      resolution = { kind: "push", message: afterAi.message, consumeDraft: false };
    } else {
      const entered = await promptGitCommitMessage({
        initialValue: afterAi.initialValue,
        hint: generated.failureReason
          ? `AI 未能生成提交信息（${generated.failureReason}），请确认或修改后推送。`
          : "AI 未能生成提交信息，请确认或修改后推送。",
      });
      if (!entered) return;
      resolution = { kind: "push", message: entered, consumeDraft: false };
    }
  }

  if (resolution.kind !== "push") return;

  const commitMessage = resolution.message;
  const consumeDraft = resolution.consumeDraft;
  options.runGitSync(
    "push",
    async () => {
      const outcome = await commitPullPushRepository(options.repositoryPath, commitMessage);
      if (consumeDraft) {
        options.commitDraft?.clear();
      }
      reportGitPushOutcome(outcome);
    },
    reportGitPushError,
  );
}
