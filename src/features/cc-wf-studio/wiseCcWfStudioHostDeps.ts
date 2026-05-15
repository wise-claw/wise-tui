import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "antd";
import {
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION,
} from "../../constants/workflowUiEvents";
import { buildClaudeSlashCommandMarkdown } from "../../services/ccWorkflowStudioClaudeSlashExport";
import {
  listCcWorkflowStudioWorkflows,
  readCcWorkflowStudioImportFile,
  readCcWorkflowStudioWorkflow,
  writeCcWorkflowStudioWorkflow,
} from "../../services/ccWorkflowStudioFiles";
import { writeProjectRelativeFile } from "../../services/materializePrdSnapshot";
import {
  dispatchCcWfStudioLaunchAiEditing,
  ensureCcWfStudioMcpForProject,
  isWiseSupportedAiEditingProvider,
  writeCcWfStudioAiEditingSkill,
  type CcWfStudioAiEditingProvider,
  type CcWfStudioMcpBridgeStatus,
} from "../../services/ccWfStudioAiEditingLaunch";
import type { CcWfStudioWiseHostDeps } from "./ccWfStudioWiseHostDeps.types";

async function pickWorkflowJsonFile(defaultDir: string): Promise<string | null> {
  const picked = (await open({
    multiple: false,
    directory: false,
    defaultPath: defaultDir,
    filters: [{ name: "Workflow JSON", extensions: ["json"] }],
  })) as string | string[] | null;
  if (typeof picked === "string") {
    return picked;
  }
  if (Array.isArray(picked) && picked.length > 0) {
    return picked[0] ?? null;
  }
  return null;
}

async function confirmWorkflowOverwrite(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: `工作流「${name}」已存在`,
      content: "是否覆盖当前仓库中的 JSON 文件？",
      okText: "覆盖",
      cancelText: "取消",
      centered: true,
      zIndex: 11000,
      getContainer: () => document.getElementById("wise-cc-wf-studio-modal-root") ?? document.body,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

async function runAiEditingLaunch(
  repositoryPath: string,
  provider: string,
  opts?: { startMcp?: boolean },
): Promise<CcWfStudioMcpBridgeStatus> {
  if (!isWiseSupportedAiEditingProvider(provider)) {
    throw new Error(`Wise 暂仅支持通过 Claude Code 一键启动 AI 编辑（当前: ${provider}）`);
  }
  const mcpStatus =
    opts?.startMcp === false
      ? await invoke<CcWfStudioMcpBridgeStatus>("cc_wf_studio_mcp_bridge_status")
      : await ensureCcWfStudioMcpForProject(repositoryPath);
  await writeCcWfStudioAiEditingSkill(repositoryPath, provider as CcWfStudioAiEditingProvider);
  dispatchCcWfStudioLaunchAiEditing({ repositoryPath, provider });
  return mcpStatus;
}

function createWiseCcWfStudioWiseHostDepsImpl(): CcWfStudioWiseHostDeps {
  return {
    listWorkflows: listCcWorkflowStudioWorkflows,
    readWorkflowJson: readCcWorkflowStudioWorkflow,
    writeWorkflowJson: writeCcWorkflowStudioWorkflow,
    readImportJsonFile: readCcWorkflowStudioImportFile,
    buildClaudeSlashMarkdown: buildClaudeSlashCommandMarkdown,
    writeProjectRelativeFile,
    pickWorkflowJsonFile,
    confirmWorkflowOverwrite,
    mcpBridgeStatus: () => invoke<CcWfStudioMcpBridgeStatus>("cc_wf_studio_mcp_bridge_status"),
    mcpBridgeResolve: (args) =>
      invoke("cc_wf_studio_mcp_bridge_resolve", {
        correlationId: args.correlationId,
        ok: args.ok,
        body: args.body,
        err: args.err,
      }),
    stopMcpBridge: () => invoke("stop_cc_wf_studio_mcp_bridge"),
    setMcpReviewBeforeApply: (value) => invoke("cc_wf_studio_mcp_set_review_before_apply", { value }),
    startMcpBridge: (projectPath) =>
      invoke<CcWfStudioMcpBridgeStatus>("start_cc_wf_studio_mcp_bridge", { projectPath }),
    ensureMcpForProject: ensureCcWfStudioMcpForProject,
    runAiEditingLaunch,
    dispatchMcpSessionEnded: () => {
      window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED));
    },
    dispatchRunInClaudeSession: (detail) => {
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION, { detail }),
      );
    },
  };
}

/** 默认 Wise 桌面绑定（Tauri + 应用服务 + 全局 workflow UI 事件）。 */
export const wiseCcWfStudioWiseHostDeps: CcWfStudioWiseHostDeps = createWiseCcWfStudioWiseHostDepsImpl();
