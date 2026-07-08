import type { MessageInstance } from "antd/es/message/interface";
import type { ModalStaticFunctions } from "antd/es/modal/confirm";
import type { NotificationInstance } from "antd/es/notification/interface";
import type { AssistantEntry } from "../types/assistant";
import type { ClaudeSession, PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "./claudeComposerPrompt";
import { openExternalUrl, isSafeExternalHref } from "./openExternal";
import { openBackgroundScript } from "./terminal";
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

/** 把脚本内容压成单行预览，长度受限；保留末尾 \n 截断语义。 */
function truncateScriptPreview(script: string, max: number): string {
  const flat = script.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

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
      // 后台通过 shell 启动执行：走 PTY 体系（`terminal_open_background_script`），
      // 输出走 terminal-output / terminal-exit 事件，前端可复用 ghostty-web
      // 终端渲染来查看/kill。失败只可能发生在 spawn 阶段（路径无效、PTY 不可用等），
      // 进程启动后用户需自行观察终端输出。
      const terminalId = `assistant-script:${input.assistant.id}:${Date.now().toString(36)}`;
      const info = await openBackgroundScript(
        // 当前 PTY session key 用 `repositoryPath` 兜底当 workspaceId：
        // 后端不强校验具体值（每个 tab 只需要唯一稳定 key），后续接入运行面板后
        // 会切换到实际 repository.id。
        repoPath,
        terminalId,
        repoPath,
        script,
        `执行脚本·${input.assistant.name?.trim() || "助手模板"}`,
      );
      // 注册到 dispatch store，运行面板「派发」一栏会显示这条后台脚本，
      // 支持结束（kill PTY 子进程）。anchor 解析复用 dispatch helper：
      // 多 pane / 多仓库场景下以当前主会话为锚，回退到 repoPath。
      const anchorSessionId =
        resolveExecutionEnvironmentDispatchAnchorSessionId({
          activeSessionId: input.preferredSessionId ?? null,
          sessions: input.sessions,
          repositoryMainSessionBindings: input.repositoryMainBindings,
          repositories: input.repositories,
        }) ?? repoPath;
      const batchId = `bg-script:${input.assistant.id}:${terminalId.split(":").pop() ?? Date.now().toString(36)}`;
      upsertExecutionEnvironmentDispatchItem({
        batchId,
        anchorSessionId,
        workerSessionId: terminalId,
        label: `执行脚本·${input.assistant.name?.trim() || "助手模板"}`,
        previewText: truncateScriptPreview(script, 240),
        batchIndex: 1,
        sessionCount: 1,
        workspaceId: repoPath,
        terminalId: info.terminalId,
        cwd: repoPath,
        pid: info.pid,
      });
      input.message.success(
        `脚本已后台启动（pid ${info.pid}，终端 ${info.terminalId.slice(0, 24)}…）`,
      );
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