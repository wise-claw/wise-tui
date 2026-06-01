#!/usr/bin/env bun
/**
 * One-shot Cursor SDK bridge for Wise Tauri backend.
 * Usage: bun scripts/cursor-sdk-bridge.ts '<json-request>'
 *
 * Request: { "method": "probe" | "models.list" | "prompt", "params"?: {...} }
 * Response: { "ok": boolean, "result"?: unknown, "error"?: string }
 */

import { resolveCursorLocalModelId } from "./cursorSdkModel.ts";
import { bridgeImagesToSdkRefs, type CursorSdkImageRef } from "./cursorSdkImages.ts";
import { sdkMessageToClaudeStreamLines } from "./cursorSdkStream.ts";
import {
  installCursorSdkStderrFilter,
  installCursorSdkStdoutGuard,
  withBridgeStdoutWrite,
} from "./cursorSdkStderrFilter.ts";

import {
  ensurePublicDir,
  runAgentWriteProbe,
} from "./cursorSdkAgentWriteProbe.ts";
import { withWiseCursorExecutePreamble } from "./cursorSdkExecutePreamble.ts";
import { runCursorSdkDeepProbe } from "./cursorSdkProbe.ts";
import { probeRepositoryFiles } from "./cursorSdkRepositoryFiles.ts";

type BridgeRequest = {
  method:
    | "probe"
    | "probe.deep"
    | "probe.repository"
    | "probe.agentWrite"
    | "models.list"
    | "prompt"
    | "execute";
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

type CursorSettingSource = "project" | "user" | "team" | "mdm" | "plugins" | "all";

/** Wise 无头 bridge 默认不加载仓库 project 层，避免目标仓 `.cursor/sandbox.json` / hooks 禁用写盘。 */
const DEFAULT_SETTING_SOURCES: CursorSettingSource[] = [];

function buildLocalAgentOptions(cwd: string, settingSources: CursorSettingSource[]) {
  return {
    cwd,
    settingSources,
    sandboxOptions: { enabled: false },
  };
}

function emitStream(event: StreamEvent): void {
  withBridgeStdoutWrite(() => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });
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

function parseSettingSourcesParam(
  params: Record<string, unknown> | undefined,
): CursorSettingSource[] {
  const raw = params?.settingSources;
  if (!Array.isArray(raw)) return DEFAULT_SETTING_SOURCES;
  const allowed = new Set<CursorSettingSource>([
    "project",
    "user",
    "team",
    "mdm",
    "plugins",
    "all",
  ]);
  const out = raw.filter(
    (value): value is CursorSettingSource =>
      typeof value === "string" && allowed.has(value as CursorSettingSource),
  );
  return out.length > 0 ? out : DEFAULT_SETTING_SOURCES;
}

async function buildSendMessage(
  prompt: string,
  images: CursorSdkImageRef[],
): Promise<string | { text: string; images: CursorSdkImageRef[] }> {
  if (images.length === 0) return prompt;
  const text = prompt.trim() || "请查看附图。";
  return { text, images };
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
  withBridgeStdoutWrite(() => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  });
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

async function handleProbeRepository(
  params: Record<string, unknown> | undefined,
): Promise<BridgeResponse> {
  const repositoryPath =
    typeof params?.repositoryPath === "string" ? params.repositoryPath.trim() : "";
  if (!repositoryPath) {
    return { ok: false, error: "params.repositoryPath is required" };
  }
  const targetRelativePath =
    typeof params?.targetRelativePath === "string" ? params.targetRelativePath : undefined;
  return { ok: true, result: probeRepositoryFiles({ repositoryPath, targetRelativePath }) };
}

async function handleProbeAgentWrite(
  params: Record<string, unknown> | undefined,
): Promise<BridgeResponse> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY 未配置" };
  }
  const repositoryPath =
    typeof params?.repositoryPath === "string" ? params.repositoryPath.trim() : "";
  if (!repositoryPath) {
    return { ok: false, error: "params.repositoryPath is required" };
  }
  const model =
    typeof params?.model === "string" ? params.model : undefined;
  try {
    ensurePublicDir(repositoryPath);
    const result = await runAgentWriteProbe({ apiKey, repositoryPath, model });
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function handleProbeDeep(
  params: Record<string, unknown> | undefined,
): Promise<BridgeResponse> {
  const sdkRoot =
    typeof params?.sdkRoot === "string" && params.sdkRoot.trim().length > 0
      ? params.sdkRoot.trim()
      : (process.env.WISE_CURSOR_SDK_ROOT?.trim() || process.cwd());
  const repositoryPath =
    typeof params?.repositoryPath === "string" ? params.repositoryPath : undefined;
  const result = runCursorSdkDeepProbe({ sdkRoot, repositoryPath });
  return { ok: true, result };
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
  const settingSources = parseSettingSourcesParam(params);
  const sdkImages = bridgeImagesToSdkRefs(params?.images);
  const message = await buildSendMessage(prompt, sdkImages);

  try {
    const { Agent } = await import("@cursor/sdk");
    const result = await Agent.prompt(withWiseCursorExecutePreamble(prompt), {
      apiKey,
      model: { id: modelId },
      mode: "agent",
      local: buildLocalAgentOptions(cwd, settingSources),
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
  const restoreStdout = installCursorSdkStdoutGuard();
  const onCancelSignal = () => {
    emitStream({ type: "error", message: "cancelled" });
    process.exit(130);
  };
  process.once("SIGTERM", onCancelSignal);
  process.once("SIGINT", onCancelSignal);

  try {
    const rawPrompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
    if (!rawPrompt) {
      emitStream({ type: "error", message: "params.prompt is required" });
      return 1;
    }
    const prompt = withWiseCursorExecutePreamble(rawPrompt);
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
    const settingSources = parseSettingSourcesParam(params);
    const sdkImages = bridgeImagesToSdkRefs(params?.images);
    const message = await buildSendMessage(prompt, sdkImages);
    const resumeAgentId =
      typeof params?.agentId === "string" && params.agentId.trim().length > 0
        ? params.agentId.trim()
        : null;

    try {
      const { Agent } = await import("@cursor/sdk");
      const agent = resumeAgentId
        ? await Agent.resume(resumeAgentId, {
            apiKey,
            local: buildLocalAgentOptions(cwd, settingSources),
            ...(mcpServers ? { mcpServers } : {}),
          })
        : await Agent.create({
            apiKey,
            model: { id: modelId },
            mode: "agent",
            local: buildLocalAgentOptions(cwd, settingSources),
            ...(mcpServers ? { mcpServers } : {}),
          });

      try {
        const agentId = String(
          (agent as { agentId?: string }).agentId ?? resumeAgentId ?? "",
        ).trim();
        if (agentId) {
          emitStream({ type: "agent", agentId });
        }

        const run = await agent.send(message, {
          mode: "agent",
          model: { id: modelId },
          ...(mcpServers ? { mcpServers } : {}),
        });
        for await (const event of run.stream()) {
          if (event.type === "assistant") {
            emitClaudeStreamLines(event);
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
    restoreStdout();
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
      case "probe.deep":
        response = await handleProbeDeep(request.params);
        break;
      case "probe.repository":
        response = await handleProbeRepository(request.params);
        break;
      case "probe.agentWrite":
        response = await handleProbeAgentWrite(request.params);
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
