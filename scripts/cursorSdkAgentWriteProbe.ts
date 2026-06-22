import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CURSOR_SDK_AGENT_WRITE_PROBE_MODEL_ID,
  resolveCursorLocalModelId,
} from "./cursorSdkModel.ts";

export type AgentWriteToolCallRecord = {
  callId: string;
  name: string;
  status: string;
};

export type AgentWriteToolCallSummary = {
  total: number;
  running: number;
  completed: number;
  error: number;
  uniqueNames: string[];
};

export type AgentWriteProbeResult = {
  modelId: string;
  runStatus: string;
  runResultText?: string | null;
  toolsAtInit: string[];
  toolCalls: AgentWriteToolCallRecord[];
  toolCallSummary: AgentWriteToolCallSummary;
  targetRelativePath: string;
  fileCreated: boolean;
  fileContent: string | null;
  agentWriteOk: boolean;
  errors: string[];
};

const WRITE_TEST_REL = "public/.wise-agent-sdk-tool-write-test.txt";

export function buildAgentWriteProbePrompt(relativePath = WRITE_TEST_REL): string {
  return [
    "Wise SDK 写盘自检：",
    `请用 write 或 edit 工具在仓库中创建文件 ${relativePath}，内容恰好一行：OK`,
    "不要调用 Task 子代理，不要只口头描述，必须实际落盘。",
  ].join("\n");
}

function summarizeToolCalls(
  records: Iterable<AgentWriteToolCallRecord>,
): AgentWriteToolCallSummary {
  const byId = new Map<string, AgentWriteToolCallRecord>();
  for (const record of records) {
    byId.set(record.callId, record);
  }
  const unique = [...byId.values()];
  const uniqueNames = [...new Set(unique.map((item) => item.name))].sort();
  return {
    total: unique.length,
    running: unique.filter((item) => item.status === "running").length,
    completed: unique.filter((item) => item.status === "completed").length,
    error: unique.filter((item) => item.status === "error").length,
    uniqueNames,
  };
}

function ingestToolCallEvent(
  toolCallsById: Map<string, AgentWriteToolCallRecord>,
  event: {
    call_id?: string;
    name?: string;
    status?: string;
  },
): void {
  const callId = typeof event.call_id === "string" ? event.call_id.trim() : "";
  const name = typeof event.name === "string" ? event.name.trim() : "";
  if (!callId || !name) return;
  const status = typeof event.status === "string" ? event.status : "running";
  toolCallsById.set(callId, { callId, name, status });
}

export async function runAgentWriteProbe(params: {
  apiKey: string;
  repositoryPath: string;
  /** 未指定时使用 {@link CURSOR_SDK_AGENT_WRITE_PROBE_MODEL_ID} */
  model?: string;
}): Promise<AgentWriteProbeResult> {
  const errors: string[] = [];
  const repositoryPath = params.repositoryPath.trim();
  const modelId = resolveCursorLocalModelId(
    params.model?.trim() || CURSOR_SDK_AGENT_WRITE_PROBE_MODEL_ID,
  );
  const toolsAtInit: string[] = [];
  const toolCallsById = new Map<string, AgentWriteToolCallRecord>();

  const { Agent } = await import("@cursor/sdk");
  const local = {
    cwd: repositoryPath,
    settingSources: ["user"] as const,
    sandboxOptions: { enabled: false },
  };

  const agent = await Agent.create({
    apiKey: params.apiKey.trim(),
    model: { id: modelId },
    mode: "agent",
    local,
  });

  try {
    const run = await agent.send(buildAgentWriteProbePrompt(), {
      mode: "agent",
      model: { id: modelId },
    });

    for await (const event of run.stream()) {
      if (event.type === "system" && event.subtype === "init" && Array.isArray(event.tools)) {
        for (const tool of event.tools) {
          if (typeof tool === "string" && !toolsAtInit.includes(tool)) toolsAtInit.push(tool);
        }
      }
      if (event.type === "tool_call") {
        ingestToolCallEvent(toolCallsById, event);
      }
    }

    const result = await run.wait();
    const toolCallSummary = summarizeToolCalls(toolCallsById.values());
    const toolCalls = [...toolCallsById.values()];

    const targetAbs = join(repositoryPath, WRITE_TEST_REL);
    let fileCreated = false;
    let fileContent: string | null = null;
    if (existsSync(targetAbs)) {
      try {
        fileContent = readFileSync(targetAbs, "utf8").trim();
        fileCreated = fileContent.length > 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`读取 ${WRITE_TEST_REL} 失败: ${message}`);
      }
    } else {
      errors.push(`Agent 结束后未找到 ${WRITE_TEST_REL}`);
    }

    if (toolsAtInit.length === 0 && toolCallSummary.uniqueNames.length === 0) {
      errors.push("流中未观察到任何工具调用（Local Agent 可能未挂载文件工具）");
    } else if (toolsAtInit.length === 0) {
      errors.push(
        `init.tools 为空，但流中观察到工具：${toolCallSummary.uniqueNames.join(", ")}（init 事件可能未携带列表）`,
      );
    } else {
      const hasWrite = toolsAtInit.some((name) => /write|edit/i.test(name));
      if (!hasWrite && !toolCallSummary.uniqueNames.some((name) => /write|edit/i.test(name))) {
        errors.push(`init.tools 不含 write/edit：${toolsAtInit.join(", ")}`);
      }
    }

    if (toolCallSummary.total > 0 && toolCallSummary.completed === 0 && toolCallSummary.error === 0) {
      errors.push(
        `共 ${toolCallSummary.total} 次工具调用均在流结束时仍为 running（Local CLI 可能未返回 completed/error，或 default 模型路由异常）`,
      );
    } else if (toolCallSummary.error > 0) {
      errors.push(`工具调用失败 ${toolCallSummary.error} 次（见 toolCalls 中 status=error）`);
    }

    if (modelId === "default" && !fileCreated) {
      errors.push("当前使用 default 模型；写盘自检已改为默认 composer-2.5，请更新 Wise 后重试");
    }

    const agentWriteOk =
      result.status !== "error" && fileCreated && fileContent === "OK";

    return {
      modelId,
      runStatus: result.status,
      runResultText: result.result ?? null,
      toolsAtInit,
      toolCalls,
      toolCallSummary,
      targetRelativePath: WRITE_TEST_REL,
      fileCreated,
      fileContent,
      agentWriteOk,
      errors,
    };
  } finally {
    try {
      const probeAbs = join(repositoryPath, WRITE_TEST_REL);
      if (existsSync(probeAbs)) unlinkSync(probeAbs);
    } catch {
      /* cleanup best-effort */
    }
    if (Symbol.asyncDispose in agent) {
      await (agent as AsyncDisposable)[Symbol.asyncDispose]();
    } else if ("close" in agent && typeof agent.close === "function") {
      agent.close();
    }
  }
}

/** 确保 public/ 存在，供落盘探测写入。 */
export function ensurePublicDir(repositoryPath: string): void {
  mkdirSync(dirname(join(repositoryPath, WRITE_TEST_REL)), { recursive: true });
}
