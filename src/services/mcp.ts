import { invoke } from "@tauri-apps/api/core";

export type TransportKind = "stdio" | "sse" | "http" | "streamable_http";

export type McpSourceWire = "user" | "builtin" | `extension:${string}`;

export interface McpTransportStdio {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTransportSse {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpTransportHttp {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpTransportStreamableHttp {
  type: "streamable_http";
  url: string;
  headers?: Record<string, string>;
}

export type McpTransport =
  | McpTransportStdio
  | McpTransportSse
  | McpTransportHttp
  | McpTransportStreamableHttp;

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  source: McpSourceWire;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  enabled?: boolean;
  source?: McpSourceWire;
}

export interface McpToolSummary {
  name: string;
  description?: string | null;
}

export type AuthMethod = "oauth" | "basic";

export interface McpConnectionTestResult {
  ok: boolean;
  tools?: McpToolSummary[];
  error?: string;
  needsAuth?: boolean;
  authMethod?: AuthMethod;
  wwwAuthenticate?: string;
}

export async function listMcpServers(): Promise<McpServer[]> {
  return invoke<McpServer[]>("mcp_list_servers");
}

export async function saveMcpServer(server: McpServerInput): Promise<McpServer> {
  return invoke<McpServer>("mcp_save_server", { arg: { server } });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await invoke<void>("mcp_delete_server", { arg: { id } });
}

export async function testMcpConnectionById(id: string): Promise<McpConnectionTestResult> {
  return invoke<McpConnectionTestResult>("mcp_test_connection", { arg: { id } });
}

export async function testMcpConnectionDraft(
  draft: McpServerInput,
): Promise<McpConnectionTestResult> {
  return invoke<McpConnectionTestResult>("mcp_test_connection", { arg: { draft } });
}

export async function getMcpSupportedTransports(engineId: string): Promise<TransportKind[]> {
  return invoke<TransportKind[]>("mcp_supported_transports", { arg: { engineId } });
}
