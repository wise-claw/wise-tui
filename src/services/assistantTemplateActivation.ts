import { createElement, type ReactElement } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { ModalStaticFunctions } from "antd/es/modal/confirm";
import type { NotificationInstance } from "antd/es/notification/interface";
import type { AssistantEntry } from "../types/assistant";
import type { ClaudeSession, PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "./claudeComposerPrompt";
import { openExternalUrl, isSafeExternalHref } from "./openExternal";
import { runShellCommand } from "./terminal";
import { resolveAssistantEntryKind } from "../utils/assistantTemplateEntry";
import { repositoryFolderBasename } from "../utils/repositoryType";
import { resolveExecutionEnvironmentDispatchAnchorSessionId } from "../utils/executionEnvironmentDispatchAnchor";
import { upsertExecutionEnvironmentDispatchItem } from "../stores/executionEnvironmentDispatchStore";
import {
  repositoryPathsMatch,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";

const DEFAULT_WORKFLOW_PROMPT = "按助手模板配置执行工作流。";

export interface ActivateAssistantTemplateInput {
  assistant: AssistantEntry;
  repositoryPath: string | null;
  /** 从会话快捷操作栏触发时传入当前会话 id，dispatch_direct 优先使用此会话而非绑定主会话。 */
  preferredSessionId?: string;
  workflowTemplates: WorkflowTemplateItem[];
  repositories: Repository[];
  sessions: ClaudeSession[];
  repositoryMainBindings: Record<string, string>;
  executeSession: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<
      PendingExecutionTask,
      "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName"
    >,
  ) => Promise<boolean>;
  /**
   * 直接执行会话而不经过团队/终端派发路由。
   * run_workflow 无 workflowId 的 worker 会话派发必须使用此路径，
   * 避免 handleComposerExecute 中的团队路由逻辑干扰新创建的 worker session。
   */
  directExecuteSession: (
    sessionId: string,
    prompt: string,
  ) => boolean;
  /** 仅 run_workflow 无 workflowId 时需要：创建独立 worker 会话，不占用主会话窗口。 */
  createSession?: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  message: MessageInstance;
  /**
   * 可选 antd `modal`：run_script 失败时弹 Modal.error 展示完整 stdout+stderr，
   * message.error 顶部仅给一行摘要。调用方传 `App.useApp().modal`；未传则
   * 降级到只 message.error（保留旧行为）。
   *
   * 注意：必须确保当前组件树被 `<App>` 包着；否则 `App.useApp()` 会返回
   * 一个 `{modal: {}}` 空对象，调 `.error` 会抛 "is not a function"，
   * 同时阻断 run_script 的后续业务流。服务层会做防御，缺失/不可用时
   * 走 notification 通道（详见 `surfaceScriptFailure`）。
   */
  modal?: Pick<ModalStaticFunctions, "error" | "warning" | "info" | "success" | "confirm">;
  /**
   * 可选 antd `notification`：当 modal 不可用时（如上游未在 `<App>` Provider 下注入），
   * 完整 stdout+stderr 改用 `notification.error` 承载。它不像 modal 能放大展示，
   * 但能稳定呈现长内容（duration: 0 + 滚动），避免脚本执行链路因 modal 报错而中断。
   * 调用方传 `App.useApp().notification`；缺失时降级到 message.error。
   */
  notification?: Pick<NotificationInstance, "success" | "warning" | "error" | "info">;
}

/**
 * 判断上游注入的 modal 是否真正可用。
 * antd `App.useApp()` 在没有 `<App>` Provider 时会返回 `{modal: {}}`，
 * 看似有效但 `.error` 不是函数，调用会抛错。
 */
function isUsableModal(
  modal: ActivateAssistantTemplateInput["modal"],
): modal is NonNullable<ActivateAssistantTemplateInput["modal"]> {
  return Boolean(modal && typeof (modal as { error?: unknown }).error === "function");
}

/**
 * 把脚本失败反馈呈给用户。
 * 优先级：
 * 1. usable modal → Modal.error（可放大的滚动 <pre>）
 * 2. usable notification → notification.error（不回滚到 message，能装长文本且不会中断脚本执行链路）
 * 3. 仅 message → 把"完整 stdout+stderr"截断若干字符塞进 message.error，避免完全看不到内容
 *
 * 切忌在 modal 不可用时直接调 `input.modal.error(...)`：上游若没在 antd `<App>` Provider 下注入，
 * `App.useApp()` 会返回 `{modal: {}}` 这种空对象，调 `.error` 会抛 "is not a function"，
 * 阻断 `run_script` 后续业务流并引发卡死观感。
 */
function surfaceScriptFailure(
  input: ActivateAssistantTemplateInput,
  payload: { exitCode: number; stderr: string; stdout: string },
): void {
  const { exitCode, stderr, stdout } = payload;
  const firstLine = (stderr || stdout).split(/\r?\n/, 1)[0] ?? "";
  const summary = firstLine
    ? `脚本退出码 ${exitCode}：${firstLine.slice(0, 160)}`
    : `脚本退出码 ${exitCode}`;
  input.message.error(summary);

  const combined = [stderr, stdout].filter((s) => s.length > 0).join("\n\n");
  const fullContent = combined.length > 0 ? combined : "(脚本无 stdout / stderr 输出)";

  if (isUsableModal(input.modal)) {
    const preNode: ReactElement = createElement(
      "pre",
      {
        style: {
          margin: 0,
          maxHeight: 420,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.55,
          background: "var(--wise-bg-elevated, rgba(0,0,0,0.04))",
          padding: 12,
          borderRadius: 6,
        },
      },
      fullContent,
    );
    input.modal.error({
      title: `脚本执行失败 · 退出码 ${exitCode}`,
      width: 720,
      okText: "关闭",
      content: preNode,
    });
    return;
  }

  if (
    input.notification &&
    typeof (input.notification as { error?: unknown }).error === "function"
  ) {
    input.notification.error({
      message: `脚本执行失败 · 退出码 ${exitCode}`,
      description: fullContent,
      duration: 0,
    });
    return;
  }

  // 兜底：把截断到 ~1 KB 的 stdout+stderr 塞进 message.error，给用户最起码的诊断线索。
  const TRUNCATE_LIMIT = 1024;
  const truncated = fullContent.length > TRUNCATE_LIMIT
    ? `${fullContent.slice(0, TRUNCATE_LIMIT)}\n…（后续 ${fullContent.length - TRUNCATE_LIMIT} 字符已省略）`
    : fullContent;
  input.message.error(`脚本退出码 ${exitCode}（输出已截断）：\n${truncated}`);
}

export async function activateAssistantTemplate(
  input: ActivateAssistantTemplateInput,
): Promise<void> {
  const kind = resolveAssistantEntryKind(input.assistant);

  if (kind === "open_link") {
    const url = input.assistant.entryUrl?.trim() ?? "";
    if (!url || !isSafeExternalHref(url)) {
      input.message.error("链接无效或未配置");
      return;
    }
    await openExternalUrl(url);
    return;
  }

  const repoPath = input.repositoryPath?.trim() ?? "";
  if (!repoPath) {
    input.message.warning("请先在左栏选择仓库后再执行");
    return;
  }

  if (kind === "run_script") {
    const script = input.assistant.entryScript?.trim() ?? "";
    if (!script) {
      input.message.error("脚本内容为空");
      return;
    }
    try {
      const result = await runShellCommand(repoPath, script);
      if (result.exit_code === 0) {
        input.message.success("脚本执行成功");
      } else {
        surfaceScriptFailure(input, {
          exitCode: result.exit_code,
          stderr: result.stderr.trim(),
          stdout: result.stdout.trim(),
        });
      }
    } catch (error) {
      input.message.error(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  // dispatch_direct / run_workflow 带 workflowId：解析目标会话
  // run_workflow 无 workflowId 跳过，不要求主会话绑定
  const workflowId = input.assistant.entryWorkflowId?.trim() ?? "";
  const needsMainSession = kind !== "run_workflow" || Boolean(workflowId);

  let targetSessionId: string | undefined;
  if (needsMainSession) {
    if (
      kind === "dispatch_direct" &&
      input.preferredSessionId?.trim() &&
      input.sessions.some((s) => s.id === input.preferredSessionId!.trim())
    ) {
      targetSessionId = input.preferredSessionId.trim();
    } else {
      const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(input.repositories, repoPath);
      const mainSessionId = resolveBoundMainSessionId(
        repoPath,
        input.repositoryMainBindings,
        input.sessions,
        mainOwnerPick,
      );
      const mainSession = mainSessionId
        ? input.sessions.find((session) => session.id === mainSessionId)
        : undefined;
      if (
        !mainSessionId ||
        !mainSession ||
        !repositoryPathsMatch(mainSession.repositoryPath, repoPath)
      ) {
        input.message.warning("未找到仓库绑定主会话，请先打开该仓库会话");
        return;
      }
      targetSessionId = mainSessionId;
    }
  }

  const promptText = input.assistant.systemPrompt?.trim() || DEFAULT_WORKFLOW_PROMPT;
  let outbound: string;
  try {
    outbound = await buildClaudeOutgoingPrompt({
      prompt: [{ type: "text", text: promptText, start: 0, end: promptText.length }],
      contextItems: [],
      images: [],
      repositoryPath: repoPath,
    });
  } catch (error) {
    input.message.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!outbound.trim()) {
    input.message.error("工作流提示词组装结果为空");
    return;
  }

  if (kind === "dispatch_direct") {
    const ok = await input.executeSession(targetSessionId!, outbound);
    if (!ok) {
      input.message.warning("立即执行未启动（可能受并发限制或主会话忙碌）");
    }
    return;
  }

  // run_workflow：
  // - entryWorkflowId 留空 → 创建独立 worker 会话执行，不占用主会话窗口
  // - entryWorkflowId 有值 → 按所选工作流入队，由 leader worker 拉起。
  if (!workflowId) {
    if (!input.createSession) {
      input.message.error("当前未注入 createSession，无法创建独立 worker 会话");
      return;
    }
    const repoFolder = repositoryFolderBasename(repoPath);
    const workerName = input.assistant.name.trim()
      ? `${repoFolder}/执行环境:${input.assistant.name.trim()}`
      : `${repoFolder}/执行环境:助手模板·派发`;
    const workerTabId = await input.createSession(repoPath, workerName, {
      skipActivate: true,
      connectionKind: "oneshot",
    });
    const ok = input.directExecuteSession(workerTabId, outbound);
    if (ok) {
      input.message.success("已派发执行助手模板");
      // 注册到执行环境派发列表，使其在运行面板可见
      // 锚点须与 useSessionConversationTasks 中的 dispatchAnchorSessionId 一致，
      // 否则运行面板找不到本条记录。
      const anchorId =
        resolveExecutionEnvironmentDispatchAnchorSessionId({
          activeSessionId: input.preferredSessionId ?? null,
          sessions: input.sessions,
          repositoryMainSessionBindings: input.repositoryMainBindings,
          repositories: input.repositories,
        }) ?? workerTabId;
      upsertExecutionEnvironmentDispatchItem({
        batchId: `run_workflow:${workerTabId}`,
        anchorSessionId: anchorId || repoPath,
        workerSessionId: workerTabId,
        label: input.assistant.name.trim() || "助手模板·派发",
        previewText: promptText.slice(0, 120),
        batchIndex: 1,
        sessionCount: 1,
      });
    } else {
      input.message.warning("派发执行未启动（可能受并发限制或主会话忙碌）");
    }
    return;
  }
  const workflow = input.workflowTemplates.find((item) => item.id === workflowId);
  if (!workflow) {
    input.message.error("所选工作流不存在");
    return;
  }

  const ok = await input.executeSession(targetSessionId!, outbound, {
    targetType: "team",
    targetWorkflowId: workflow.id,
    targetWorkflowName: workflow.name.trim() || workflow.id,
  });
  if (ok) {
    input.message.success(`已启动工作流「${workflow.name.trim() || workflow.id}」`);
  } else {
    input.message.warning("工作流执行未启动（可能受并发限制或主会话忙碌）");
  }
}