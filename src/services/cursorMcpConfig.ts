import { invoke } from "@tauri-apps/api/core";
import type { McpTransport } from "./mcp";
import { listMcpServers } from "./mcp";
import type { ClaudeSpawnCliExtras } from "./claudeSpawnExtras";

export type CursorMcpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type?: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

export function wiseMcpTransportToCursor(transport: McpTransport): CursorMcpServerConfig | null {
  switch (transport.type) {
    case "stdio":
      return {
        type: "stdio",
        command: transport.command,
        args: transport.args,
        env: transport.env,
      };
    case "sse":
      return {
        type: "sse",
        url: transport.url,
        headers: transport.headers,
      };
    case "http":
      return {
        type: "http",
        url: transport.url,
        headers: transport.headers,
      };
    case "streamable_http":
      return {
        type: "http",
        url: transport.url,
        headers: transport.headers,
      };
    default:
      return null;
  }
}

export async function readSpawnMcpServers(
  configPath: string,
): Promise<Record<string, CursorMcpServerConfig>> {
  const trimmed = configPath.trim();
  if (!trimmed) return {};
  const raw = await invoke<Record<string, unknown>>("cursor_agent_read_spawn_mcp_servers", {
    configPath: trimmed,
  });
  const out: Record<string, CursorMcpServerConfig> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!key.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[key] = value as CursorMcpServerConfig;
  }
  return out;
}

export async function buildCursorMcpServersForSpawn(params: {
  spawnExtras: ClaudeSpawnCliExtras | null;
}): Promise<Record<string, CursorMcpServerConfig>> {
  const out: Record<string, CursorMcpServerConfig> = {};

  try {
    for (const server of await listMcpServers()) {
      if (!server.enabled) continue;
      const cfg = wiseMcpTransportToCursor(server.transport);
      if (!cfg) continue;
      const key = server.name.trim() || server.id.trim();
      if (!key) continue;
      out[key] = cfg;
    }
  } catch {
    // Wise MCP 列表不可用时仍尝试助手 bundle。
  }

  const configPath = params.spawnExtras?.mcpConfigPath?.trim();
  if (configPath) {
    try {
      const fromFile = await readSpawnMcpServers(configPath);
      Object.assign(out, fromFile);
    } catch {
      // 物化路径失效时不阻断 Cursor 执行。
    }
  }

  return out;
}
