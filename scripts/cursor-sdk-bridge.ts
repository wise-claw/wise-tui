#!/usr/bin/env bun
/**
 * One-shot Cursor SDK bridge for Wise Tauri backend.
 * Usage: bun scripts/cursor-sdk-bridge.ts '<json-request>'
 *
 * Request: { "method": "probe" | "models.list" | "prompt", "params"?: {...} }
 * Response: { "ok": boolean, "result"?: unknown, "error"?: string }
 */

import { resolveCursorLocalModelId } from "./cursorSdkModel.ts";
import { sdkMessageToClaudeStreamLines } from "./cursorSdkStream.ts";
import { installCursorSdkStderrFilter } from "./cursorSdkStderrFilter.ts";

type BridgeRequest = {
  method: "probe" | "models.list" | "prompt" | "execute";
  params?: Record<string, unknown>;
};

type BridgeResponse = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

type StreamEvent =
  | { type: "agent"; agentId: string }
  | { type: "assistant"; text: string }
  | { type: "stream_line"; line: string }
  | { type: "complete"; success: boolean; agentId?: string; status?: string }
  | { type: "error"; message: string };

type CursorMcpServerConfig = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
};

function emitStream(event: StreamEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitClaudeStreamLines(event: {
  type: string;
  message?: { role?: string; content?: unknown[] };
  call_id?: string;
  name?: string;
  status?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
}): void {
  for (const line of sdkMessageToClaudeStreamLines(event)) {
    emitStream({ type: "stream_line", line: JSON.stringify(line) });
  }
}

function parseMcpServersParam(
  params: Record<string, unknown> | undefined,
): Record<string, CursorMcpServerConfig> | undefined {
  const raw = params?.mcpServers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, CursorMcpServerConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[name] = value as CursorMcpServerConfig;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readRequest(): BridgeRequest {
  const raw = process.argv[2]?.trim();
  if (!raw) {
    throw new Error("missing JSON request argument");
  }
  const parsed = JSON.parse(raw) as BridgeRequest;
  if (!parsed.method) {
    throw new Error("request.method is required");
  }
  return parsed;
}

function respond(payload: BridgeResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleProbe(): Promise<BridgeResponse> {
  try {
    await import("@cursor/sdk");
    return { ok: true, result: { sdkAvailable: true } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, result: { sdkAvailable: false, error: message } };
  }
}

async function handleModelsList(): Promise<BridgeResponse> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY 未配置" };
  }
  try {
    const { Cursor } = await import("@cursor/sdk");
    const models = await Cursor.models.list({ apiKey });
    return {
      ok: true,
      result: {
        modelCount: models.length,
        models: models.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          description: item.description ?? null,
          aliases: item.aliases ?? [],
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function handlePrompt(params: Record<string, unknown> | undefined): Promise<BridgeResponse> {
  const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: "params.prompt is required" };
  }
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY 未配置" };
  }
  const cwd =
    typeof params?.cwd === "string" && params.cwd.trim().length > 0
      ? params.cwd.trim()
      : process.cwd();
  const modelId = resolveCursorLocalModelId(
    typeof params?.model === "string" ? params.model : undefined,
  );
  const mcpServers = parseMcpServersParam(params);

  try {
    const { Agent } = await import("@cursor/sdk");
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: modelId },
      local: { cwd, settingSources: [] },
      ...(mcpServers ? { mcpServers } : {}),
    });
    return {
      ok: true,
      result: {
        status: result.status,
        runId: result.id,
        text: result.result ?? "",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function handleExecute(params: Record<string, unknown> | undefined): Promise<number> {
  const restoreStderr = installCursorSdkStderrFilter();
  const onCancelSignal = () => {
    emitStream({ type: "error", message: "cancelled" });
    process.exit(130);
  };
  process.once("SIGTERM", onCancelSignal);
  process.once("SIGINT", onCancelSignal);

  try {
    const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
    if (!prompt) {
      emitStream({ type: "error", message: "params.prompt is required" });
      return 1;
    }
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      emitStream({ type: "error", message: "CURSOR_API_KEY 未配置" });
      return 1;
    }
    const cwd =
      typeof params?.cwd === "string" && params.cwd.trim().length > 0
        ? params.cwd.trim()
        : process.cwd();
    const modelId = resolveCursorLocalModelId(
      typeof params?.model === "string" ? params.model : undefined,
    );
    const mcpServers = parseMcpServersParam(params);
    const resumeAgentId =
      typeof params?.agentId === "string" && params.agentId.trim().length > 0
        ? params.agentId.trim()
        : null;

    try {
      const { Agent } = await import("@cursor/sdk");
      const agent = resumeAgentId
        ? await Agent.resume(resumeAgentId, {
            apiKey,
            local: { cwd, settingSources: [] },
            ...(mcpServers ? { mcpServers } : {}),
          })
        : await Agent.create({
            apiKey,
            model: { id: modelId },
            local: { cwd, settingSources: [] },
            ...(mcpServers ? { mcpServers } : {}),
          });

      try {
        const agentId = String(
          (agent as { agentId?: string }).agentId ?? resumeAgentId ?? "",
        ).trim();
        if (agentId) {
          emitStream({ type: "agent", agentId });
        }

        const run = await agent.send(prompt, {
          model: { id: modelId },
          ...(mcpServers ? { mcpServers } : {}),
        });
        for await (const event of run.stream()) {
          if (event.type === "assistant") {
            emitClaudeStreamLines(event);
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                emitStream({ type: "assistant", text: block.text });
              }
            }
            continue;
          }
          if (
            event.type === "tool_call" ||
            event.type === "thinking"
          ) {
            emitClaudeStreamLines(event);
          }
        }

        const result = await run.wait();
        const success = result.status !== "error";
        emitStream({
          type: "complete",
          success,
          agentId: agentId || undefined,
          status: result.status,
        });
        return success ? 0 : 2;
      } finally {
        process.off("SIGTERM", onCancelSignal);
        process.off("SIGINT", onCancelSignal);
        if (Symbol.asyncDispose in agent) {
          await (agent as AsyncDisposable)[Symbol.asyncDispose]();
        } else if ("close" in agent && typeof agent.close === "function") {
          await agent.close();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitStream({ type: "error", message });
      return 1;
    }
  } finally {
    restoreStderr();
  }
}

async function main(): Promise<void> {
  let request: BridgeRequest;
  try {
    request = readRequest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ ok: false, error: message });
    process.exit(1);
    return;
  }

  try {
    if (request.method === "execute") {
      const code = await handleExecute(request.params);
      process.exit(code);
      return;
    }

    let response: BridgeResponse;
    switch (request.method) {
      case "probe":
        response = await handleProbe();
        break;
      case "models.list":
        response = await handleModelsList();
        break;
      case "prompt":
        response = await handlePrompt(request.params);
        break;
      default:
        response = { ok: false, error: `unsupported method: ${String(request.method)}` };
    }
    respond(response);
    process.exit(response.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method === "execute") {
      emitStream({ type: "error", message });
    } else {
      respond({ ok: false, error: message });
    }
    process.exit(1);
  }
}

await main();
