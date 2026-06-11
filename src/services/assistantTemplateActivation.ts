import type { MessageInstance } from "antd/es/message/interface";
import type { AssistantEntry } from "../types/assistant";
import type { ClaudeSession, PendingExecutionTask, Repository, WorkflowTemplateItem } from "../types";
import { buildClaudeOutgoingPrompt } from "./claudeComposerPrompt";
import { openExternalUrl, isSafeExternalHref } from "./openExternal";
import { runShellCommand } from "./terminal";
import { resolveAssistantEntryKind } from "../utils/assistantTemplateEntry";
import {
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";

const DEFAULT_WORKFLOW_PROMPT = "按助手模板配置执行工作流。";

export interface ActivateAssistantTemplateInput {
  assistant: AssistantEntry;
  repositoryPath: string | null;
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
  openConversation: (assistantId: string) => void;
  message: MessageInstance;
}

export async function activateAssistantTemplate(
  input: ActivateAssistantTemplateInput,
): Promise<void> {
  const kind = resolveAssistantEntryKind(input.assistant);

  if (kind === "conversation") {
    input.openConversation(input.assistant.id);
    return;
  }

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
        const detail = result.stderr.trim() || result.stdout.trim();
        input.message.error(
          detail ? `脚本退出码 ${result.exit_code}：${detail.slice(0, 200)}` : `脚本退出码 ${result.exit_code}`,
        );
      }
    } catch (error) {
      input.message.error(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const workflowId = input.assistant.entryWorkflowId?.trim() ?? "";
  if (!workflowId) {
    input.message.error("未配置工作流");
    return;
  }
  const workflow = input.workflowTemplates.find((item) => item.id === workflowId);
  if (!workflow) {
    input.message.error("所选工作流不存在");
    return;
  }

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
  if (!mainSessionId || !mainSession || mainSession.repositoryPath.trim() !== repoPath) {
    input.message.warning("未找到仓库绑定主会话，请先打开该仓库会话");
    return;
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

  const ok = await input.executeSession(mainSessionId, outbound, {
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
