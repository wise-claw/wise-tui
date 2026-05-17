import type { Workflow } from "@cc-workflow-studio-core/workflow-definition";
import {
  emitExtensionToWebviewMessage,
  registerCcWfStudioWebviewHandler,
} from "./wiseVscodeApi";
import type { CcWfStudioWiseHostDeps } from "./ccWfStudioWiseHostDeps.types";

function postToWebview(msg: Record<string, unknown>) {
  emitExtensionToWebviewMessage(msg);
}

function migrateWorkflowLocal(w: Workflow): Workflow {
  return w;
}

async function persistWorkflowJsonAndClaudeSlashCommand(
  repositoryPath: string,
  workflow: Workflow,
  highlightEnabled: boolean,
  deps: CcWfStudioWiseHostDeps,
): Promise<void> {
  const next = { ...workflow, updatedAt: new Date() } as Workflow;
  const json = JSON.stringify(next, null, 2);
  await deps.writeWorkflowJson(repositoryPath, workflow.name, json);
  const md = deps.buildClaudeSlashMarkdown(workflow, highlightEnabled);
  await deps.writeProjectRelativeFile(repositoryPath, `.claude/commands/${workflow.name}.md`, md);
}

function postMcpServerStatus(
  repositoryPath: string,
  status: { running: boolean; port: number | null },
) {
  postToWebview({
    type: "MCP_SERVER_STATUS",
    payload: {
      running: status.running,
      port: status.port,
      configsWritten: status.running
        ? [{ target: "claude-code", path: `${repositoryPath}/.mcp.json` }]
        : [],
      reviewBeforeApply: true,
    },
  });
}

export interface CcWfStudioHostController {
  dispose(): void;
}

/**
 * 注册 CC Workflow Studio Webview → Wise 宿主消息路由（对齐上游 `open-editor` 消息类型子集，其余安全忽略或返回占位）。
 *
 * @param deps 宿主能力注入；生产环境使用 `wiseCcWfStudioWiseHostDeps`。
 */
export function mountCcWfStudioWiseHost(
  repositoryPath: string,
  deps: CcWfStudioWiseHostDeps,
): CcWfStudioHostController {
  const ns = repositoryPath.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 120);

  const handler = async (raw: unknown) => {
    if (!repositoryPath.trim()) {
      return;
    }
    const msg = raw as {
      type?: string;
      requestId?: string;
      payload?: Record<string, unknown>;
    };
    const type = msg.type;
    const requestId = msg.requestId;

    try {
      switch (type) {
        case "WEBVIEW_READY": {
          postToWebview({
            type: "INITIAL_STATE",
            payload: {
              isFirstTimeUser: false,
              unreadReleaseCount: 0,
              showWhatsNewBadge: false,
              extensionVersion: "3.34.1-wise",
              recentWorkflows: [],
            },
          });
          break;
        }
        case "LOAD_WORKFLOW_LIST": {
          const workflows = await deps.listWorkflows(repositoryPath);
          postToWebview({
            type: "WORKFLOW_LIST_LOADED",
            requestId,
            payload: { workflows },
          });
          break;
        }
        case "OPEN_FILE_PICKER": {
          try {
            const path = await deps.pickWorkflowJsonFile(repositoryPath);
            if (!path) {
              postToWebview({ type: "FILE_PICKER_CANCELLED" });
              break;
            }
            const content = await deps.readImportJsonFile(path);
            const parsed = JSON.parse(content) as Workflow;
            const workflow = migrateWorkflowLocal(parsed);
            postToWebview({
              type: "LOAD_WORKFLOW",
              payload: { workflow },
            });
          } catch (e) {
            postToWebview({
              type: "ERROR",
              payload: {
                code: "LOAD_FAILED",
                message: e instanceof Error ? e.message : String(e),
              },
            });
          }
          break;
        }
        case "LOAD_WORKFLOW": {
          const workflowId = (msg.payload as { workflowId?: string } | undefined)?.workflowId;
          if (!workflowId) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: { code: "VALIDATION_ERROR", message: "缺少 workflowId" },
            });
            break;
          }
          try {
            const content = await deps.readWorkflowJson(repositoryPath, workflowId);
            const parsed = JSON.parse(content) as Workflow;
            const workflow = migrateWorkflowLocal(parsed);
            postToWebview({
              type: "LOAD_WORKFLOW",
              requestId,
              payload: { workflow },
            });
          } catch (e) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: {
                code: "LOAD_FAILED",
                message: e instanceof Error ? e.message : "读取工作流失败",
              },
            });
          }
          break;
        }
        case "SAVE_WORKFLOW": {
          const workflow = msg.payload?.workflow as Workflow | undefined;
          if (!workflow?.name) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: { code: "VALIDATION_ERROR", message: "Workflow is required" },
            });
            break;
          }
          let exists = false;
          try {
            await deps.readWorkflowJson(repositoryPath, workflow.name);
            exists = true;
          } catch {
            exists = false;
          }
          if (exists) {
            const ok = await deps.confirmWorkflowOverwrite(workflow.name);
            if (!ok) {
              postToWebview({ type: "SAVE_CANCELLED", requestId });
              break;
            }
          }
          const next = {
            ...workflow,
            updatedAt: new Date(),
          } as Workflow;
          const json = JSON.stringify(next, null, 2);
          await deps.writeWorkflowJson(repositoryPath, workflow.name, json);
          postToWebview({
            type: "SAVE_SUCCESS",
            requestId,
            payload: {
              filePath: `${repositoryPath}/.wise/workflows/${workflow.name}.json`,
              timestamp: new Date().toISOString(),
            },
          });
          break;
        }
        case "STATE_UPDATE":
          // 上游用于扩展侧持久化草稿；Wise 依赖 getState/setState，此处不重复写盘。
          break;
        case "GET_MCP_SERVER_STATUS": {
          try {
            const s = await deps.mcpBridgeStatus();
            postToWebview({
              type: "MCP_SERVER_STATUS",
              payload: {
                running: s.running,
                port: s.port,
                configsWritten: s.running
                  ? [{ target: "claude-code", path: `${repositoryPath}/.mcp.json` }]
                  : [],
                reviewBeforeApply: true,
              },
            });
          } catch {
            postToWebview({
              type: "MCP_SERVER_STATUS",
              payload: {
                running: false,
                port: null,
                configsWritten: [],
                reviewBeforeApply: false,
              },
            });
          }
          break;
        }
        case "GET_CURRENT_WORKFLOW_RESPONSE": {
          const pl = msg.payload as { correlationId?: string } | undefined;
          const cid = typeof pl?.correlationId === "string" ? pl.correlationId : "";
          if (cid) {
            await deps.mcpBridgeResolve({
              correlationId: cid,
              ok: true,
              body: (msg.payload ?? null) as Record<string, unknown> | null,
              err: null,
            });
          }
          break;
        }
        case "APPLY_WORKFLOW_FROM_MCP_RESPONSE": {
          const pl = msg.payload as {
            correlationId?: string;
            success?: boolean;
            error?: string;
            currentRevision?: number;
          };
          const cid = typeof pl?.correlationId === "string" ? pl.correlationId : "";
          if (cid) {
            const ok = pl.success !== false;
            await deps.mcpBridgeResolve({
              correlationId: cid,
              ok,
              body: {
                success: pl.success,
                error: pl.error,
                currentRevision: pl.currentRevision,
              },
              err: ok ? null : (pl.error ?? "apply_workflow failed"),
            });
          }
          break;
        }
        case "STOP_MCP_SERVER": {
          try {
            await deps.stopMcpBridge();
          } catch {
            /* ignore */
          }
          deps.dispatchMcpSessionEnded();
          postToWebview({
            type: "MCP_SERVER_STATUS",
            payload: {
              running: false,
              port: null,
              configsWritten: [],
              reviewBeforeApply: false,
            },
          });
          break;
        }
        case "SET_REVIEW_BEFORE_APPLY": {
          const value = Boolean(
            (msg.payload as { value?: boolean } | undefined)?.value,
          );
          try {
            await deps.setMcpReviewBeforeApply(value);
          } catch {
            /* ignore */
          }
          break;
        }
        case "START_MCP_SERVER": {
          try {
            const s = await deps.startMcpBridge(repositoryPath);
            postToWebview({
              type: "MCP_SERVER_STATUS",
              payload: {
                running: s.running,
                port: s.port,
                configsWritten: [{ target: "claude-code", path: `${repositoryPath}/.mcp.json` }],
                reviewBeforeApply: true,
              },
            });
          } catch (e) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: {
                code: "MCP_START_FAILED",
                message: e instanceof Error ? e.message : String(e),
              },
            });
          }
          break;
        }
        case "LIST_SAMPLE_WORKFLOWS": {
          postToWebview({
            type: "SAMPLE_WORKFLOW_LIST",
            requestId,
            payload: { samples: [] },
          });
          break;
        }
        case "GET_CHANGELOG": {
          postToWebview({
            type: "GET_CHANGELOG_RESULT",
            requestId,
            payload: {
              entries: [],
              unreadCount: 0,
              currentVersion: "3.34.1-wise",
            },
          });
          break;
        }
        case "LIST_COPILOT_MODELS": {
          postToWebview({
            type: "COPILOT_MODELS_LIST",
            requestId,
            payload: {
              models: [],
              available: false,
              unavailableReason: "Wise 未接入 VS Code LM API",
            },
          });
          break;
        }
        case "GET_RESPONSE_LANGUAGE": {
          postToWebview({
            type: "GET_RESPONSE_LANGUAGE_RESULT",
            requestId,
            payload: { language: "zh-CN" },
          });
          break;
        }
        case "SET_RESPONSE_LANGUAGE":
          break;
        case "LAUNCH_AI_AGENT": {
          const provider = (msg.payload as { provider?: string } | undefined)?.provider?.trim();
          if (!provider) {
            postToWebview({
              type: "LAUNCH_AI_AGENT_FAILED",
              requestId,
              payload: {
                errorMessage: "缺少 provider",
                timestamp: new Date().toISOString(),
              },
            });
            break;
          }
          try {
            const status = await deps.runAiEditingLaunch(repositoryPath, provider, { startMcp: true });
            postMcpServerStatus(repositoryPath, status);
            postToWebview({
              type: "LAUNCH_AI_AGENT_SUCCESS",
              requestId,
              payload: {
                provider,
                timestamp: new Date().toISOString(),
              },
            });
          } catch (e) {
            postToWebview({
              type: "LAUNCH_AI_AGENT_FAILED",
              requestId,
              payload: {
                errorMessage: e instanceof Error ? e.message : String(e),
                timestamp: new Date().toISOString(),
              },
            });
          }
          break;
        }
        case "RUN_AI_EDITING_SKILL": {
          const provider = (msg.payload as { provider?: string } | undefined)?.provider?.trim();
          if (!provider) {
            postToWebview({
              type: "RUN_AI_EDITING_SKILL_FAILED",
              requestId,
              payload: {
                errorMessage: "缺少 provider",
                timestamp: new Date().toISOString(),
              },
            });
            break;
          }
          try {
            await deps.runAiEditingLaunch(repositoryPath, provider, { startMcp: false });
            postToWebview({
              type: "RUN_AI_EDITING_SKILL_SUCCESS",
              requestId,
              payload: {
                provider,
                timestamp: new Date().toISOString(),
              },
            });
          } catch (e) {
            postToWebview({
              type: "RUN_AI_EDITING_SKILL_FAILED",
              requestId,
              payload: {
                errorMessage: e instanceof Error ? e.message : String(e),
                timestamp: new Date().toISOString(),
              },
            });
          }
          break;
        }
        case "EXPORT_WORKFLOW": {
          const pl = msg.payload as { workflow?: Workflow; highlightEnabled?: boolean } | undefined;
          const workflow = pl?.workflow;
          if (!workflow?.name?.trim()) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: { code: "VALIDATION_ERROR", message: "缺少 workflow" },
            });
            break;
          }
          const hl = pl?.highlightEnabled !== false;
          try {
            await persistWorkflowJsonAndClaudeSlashCommand(repositoryPath, workflow, hl, deps);
            postToWebview({
              type: "EXPORT_SUCCESS",
              payload: {
                exportedFiles: [
                  `.wise/workflows/${workflow.name}.json`,
                  `.claude/commands/${workflow.name}.md`,
                ],
                timestamp: new Date().toISOString(),
              },
            });
          } catch (e) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: {
                code: "EXPORT_FAILED",
                message: e instanceof Error ? e.message : String(e),
              },
            });
          }
          break;
        }
        case "RUN_AS_SLASH_COMMAND": {
          const pl = msg.payload as { workflow?: Workflow; highlightEnabled?: boolean } | undefined;
          const workflow = pl?.workflow;
          if (!workflow?.name?.trim()) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: { code: "VALIDATION_ERROR", message: "缺少 workflow" },
            });
            break;
          }
          const hl = pl?.highlightEnabled !== false;
          try {
            await persistWorkflowJsonAndClaudeSlashCommand(repositoryPath, workflow, hl, deps);
            await deps.ensureMcpForProject(repositoryPath);
            deps.dispatchRunInClaudeSession({
              repositoryPath,
              slashCommand: `/${workflow.name}`,
            });
            postToWebview({
              type: "RUN_AS_SLASH_COMMAND_SUCCESS",
              requestId,
              payload: {
                workflowName: workflow.name,
                terminalName: "Wise Claude Code 会话",
                timestamp: new Date().toISOString(),
              },
            });
          } catch (e) {
            postToWebview({
              type: "ERROR",
              requestId,
              payload: {
                code: "RUN_FAILED",
                message: e instanceof Error ? e.message : String(e),
              },
            });
          }
          break;
        }
        default:
          // Slack / 精炼等仍依赖 VS Code 扩展宿主；未列出的消息类型在 Wise 中忽略。
          break;
      }
    } catch (e) {
      postToWebview({
        type: "ERROR",
        requestId,
        payload: {
          code: "WISE_HOST_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      });
    }
  };

  registerCcWfStudioWebviewHandler((m) => void handler(m), ns);

  return {
    dispose() {
      registerCcWfStudioWebviewHandler(null, ns);
    },
  };
}
