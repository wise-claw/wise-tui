import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface CodexApprovalRequestPayload {
  session_id: string;
  request_id: number;
  type: 'commandExecution' | 'fileChange' | 'unknown';
  // For commandExecution:
  command?: string;
  cwd?: string;
  reason?: string;
  available_decisions?: string[];
  // For unknown:
  method?: string;
}

export interface CodexApprovalResolvedPayload {
  session_id: string;
  request_id: number;
}

export interface McpServerStatusInfo {
  name: string;
  auth_status?: string;
  [key: string]: unknown;
}

export interface McpElicitationRequestPayload {
  session_id: string;
  request_id: number;
  server_name?: string;
  thread_id?: string;
  turn_id?: string;
  message?: string;
  requested_schema?: unknown;
}

/** Listen for approval requests from the codex RPC backend */
export function onCodexApprovalRequest(
  callback: (payload: CodexApprovalRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<CodexApprovalRequestPayload>('codex-rpc:approval-request', (event) => {
    callback(event.payload);
  });
}

/** Listen for approval resolution */
export function onCodexApprovalResolved(
  callback: (payload: CodexApprovalResolvedPayload) => void,
): Promise<UnlistenFn> {
  return listen<CodexApprovalResolvedPayload>('codex-rpc:approval-resolved', (event) => {
    callback(event.payload);
  });
}

/** Send an approval decision back to the codex app-server.
 *
 * The Rust command accepts individual parameters (not a nested `params` object).
 */
export async function respondCodexApproval(
  sessionId: string,
  requestId: number,
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel',
): Promise<void> {
  await invoke('respond_codex_rpc_approval', {
    sessionId,
    requestId,
    decision,
  });
}

// ---------------------------------------------------------------------------
// MCP functions (Phase 3)
// ---------------------------------------------------------------------------

/** Listen for MCP elicitation requests from the codex RPC backend */
export function onCodexMcpElicitationRequest(
  callback: (payload: McpElicitationRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<McpElicitationRequestPayload>('codex-rpc:mcp-elicitation-request', (event) => {
    callback(event.payload);
  });
}

/** List MCP server statuses for an active session */
export async function listCodexMcpServers(sessionId: string): Promise<McpServerStatusInfo[]> {
  return invoke('list_codex_rpc_mcp_servers', {
    params: { sessionId },
  });
}

/** Call an MCP tool directly */
export async function callCodexMcpTool(
  sessionId: string,
  server: string,
  tool: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  return invoke('call_codex_rpc_mcp_tool', {
    params: { sessionId, server, tool, arguments: args },
  });
}

/** Start MCP OAuth login for a server */
export async function startCodexMcpOAuth(
  sessionId: string,
  server: string,
): Promise<{ authorization_url?: string }> {
  return invoke('start_codex_rpc_mcp_oauth', {
    params: { sessionId, server },
  });
}

/** Respond to an MCP elicitation request */
export async function respondCodexMcpElicitation(
  sessionId: string,
  requestId: number,
  action: 'accept' | 'decline' | 'cancel',
  content?: unknown,
): Promise<void> {
  await invoke('respond_codex_rpc_mcp_elicitation', {
    params: { sessionId, requestId, action, content },
  });
}

// ---------------------------------------------------------------------------
// Command execution (Phase 4)
// ---------------------------------------------------------------------------

export interface CommandExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/** Execute a sandboxed command via the codex app-server */
export async function execCodexCommand(
  sessionId: string,
  command: string[],
  options?: {
    processId?: string;
    tty?: boolean;
    streamStdin?: boolean;
    streamStdoutStderr?: boolean;
    timeoutMs?: number;
    cwd?: string;
    env?: Record<string, string | null>;
  },
): Promise<CommandExecResult> {
  return invoke('exec_codex_rpc_command', {
    params: {
      sessionId,
      command,
      processId: options?.processId,
      tty: options?.tty ?? false,
      streamStdin: options?.streamStdin ?? false,
      streamStdoutStderr: options?.streamStdoutStderr ?? false,
      timeoutMs: options?.timeoutMs,
      cwd: options?.cwd,
      env: options?.env,
    },
  });
}

/** Terminate a running command */
export async function terminateCodexCommand(
  sessionId: string,
  processId: string,
): Promise<void> {
  await invoke('terminate_codex_rpc_command', {
    params: { sessionId, processId },
  });
}

/** Write stdin bytes to a running command */
export async function writeCodexCommandStdin(
  sessionId: string,
  processId: string,
  deltaBase64?: string,
  closeStdin?: boolean,
): Promise<void> {
  await invoke('write_codex_rpc_command_stdin', {
    params: { sessionId, processId, deltaBase64, closeStdin: closeStdin ?? false },
  });
}

/** Resize a PTY-backed command */
export async function resizeCodexCommand(
  sessionId: string,
  processId: string,
  rows: number,
  cols: number,
): Promise<void> {
  await invoke('resize_codex_rpc_command', {
    params: { sessionId, processId, rows, cols },
  });
}

// ---------------------------------------------------------------------------
// Filesystem operations (Phase 4)
// ---------------------------------------------------------------------------

export interface FsMetadataResult {
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  createdAtMs: number;
  modifiedAtMs: number;
}

export interface FsDirectoryEntry {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FsDirectoryResult {
  entries: FsDirectoryEntry[];
}

/** Read a file (returns base64-encoded contents) */
export async function codexFsReadFile(
  sessionId: string,
  path: string,
): Promise<string> {
  return invoke('codex_rpc_fs_read_file', {
    params: { sessionId, path },
  });
}

/** Write a file (base64-encoded data) */
export async function codexFsWriteFile(
  sessionId: string,
  path: string,
  dataBase64: string,
): Promise<void> {
  await invoke('codex_rpc_fs_write_file', {
    params: { sessionId, path, dataBase64 },
  });
}

/** Create a directory */
export async function codexFsCreateDirectory(
  sessionId: string,
  path: string,
  recursive?: boolean,
): Promise<void> {
  await invoke('codex_rpc_fs_create_directory', {
    params: { sessionId, path, recursive: recursive ?? true },
  });
}

/** Get metadata for a path */
export async function codexFsGetMetadata(
  sessionId: string,
  path: string,
): Promise<FsMetadataResult> {
  return invoke('codex_rpc_fs_get_metadata', {
    params: { sessionId, path },
  });
}

/** Read a directory */
export async function codexFsReadDirectory(
  sessionId: string,
  path: string,
): Promise<FsDirectoryResult> {
  return invoke('codex_rpc_fs_read_directory', {
    params: { sessionId, path },
  });
}

/** Remove a file or directory */
export async function codexFsRemove(
  sessionId: string,
  path: string,
  recursive?: boolean,
  force?: boolean,
): Promise<void> {
  await invoke('codex_rpc_fs_remove', {
    params: { sessionId, path, recursive: recursive ?? true, force: force ?? true },
  });
}

/** Copy a file or directory */
export async function codexFsCopy(
  sessionId: string,
  sourcePath: string,
  destinationPath: string,
  recursive?: boolean,
): Promise<void> {
  await invoke('codex_rpc_fs_copy', {
    params: { sessionId, sourcePath, destinationPath, recursive: recursive ?? false },
  });
}

/** Start a filesystem watch */
export async function codexFsWatch(
  sessionId: string,
  watchId: string,
  path: string,
): Promise<{ path: string }> {
  return invoke('codex_rpc_fs_watch', {
    params: { sessionId, watchId, path },
  });
}

/** Stop a filesystem watch */
export async function codexFsUnwatch(
  sessionId: string,
  watchId: string,
): Promise<void> {
  await invoke('codex_rpc_fs_unwatch', {
    params: { sessionId, watchId },
  });
}

// ---------------------------------------------------------------------------
// Thread management (Phase 5)
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ThreadListResponse {
  data: ThreadSummary[];
  has_more?: boolean;
}

export interface CodexDynamicToolRequestPayload {
  session_id: string;
  request_id: number;
  thread_id?: string;
  turn_id?: string;
  item_id?: string;
  namespace?: string;
  tool?: string;
  arguments?: unknown;
}

/** List threads via the codex app-server */
export async function listCodexThreads(
  sessionId: string,
  limit?: number,
  offset?: number,
  archived?: boolean,
): Promise<ThreadListResponse> {
  return invoke('list_codex_rpc_threads', {
    params: { sessionId, limit, offset, archived },
  });
}

/** Archive a thread via the codex app-server */
export async function archiveCodexThread(
  sessionId: string,
  threadId: string,
): Promise<void> {
  await invoke('archive_codex_rpc_thread', {
    params: { sessionId, threadId },
  });
}

/** Unarchive a thread via the codex app-server */
export async function unarchiveCodexThread(
  sessionId: string,
  threadId: string,
): Promise<void> {
  await invoke('unarchive_codex_rpc_thread', {
    params: { sessionId, threadId },
  });
}

/** Delete a thread via the codex app-server */
export async function deleteCodexThread(
  sessionId: string,
  threadId: string,
): Promise<void> {
  await invoke('delete_codex_rpc_thread', {
    params: { sessionId, threadId },
  });
}

/** Fork a thread via the codex app-server */
export async function forkCodexThread(
  sessionId: string,
  threadId: string,
  name?: string,
): Promise<ThreadSummary> {
  return invoke('fork_codex_rpc_thread', {
    params: { sessionId, threadId, name },
  });
}

/** Read a thread via the codex app-server */
export async function readCodexThread(
  sessionId: string,
  threadId: string,
): Promise<unknown> {
  return invoke('read_codex_rpc_thread', {
    params: { sessionId, threadId },
  });
}

/** Listen for dynamic tool call requests from the codex RPC backend */
export function onCodexDynamicToolRequest(
  callback: (payload: CodexDynamicToolRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<CodexDynamicToolRequestPayload>('codex-rpc:dynamic-tool-request', (event) => {
    callback(event.payload);
  });
}

// ---------------------------------------------------------------------------
// Turn steering (Phase 5)
// ---------------------------------------------------------------------------

/** Steer the active turn via the codex app-server */
export async function steerCodexTurn(
  sessionId: string,
  turnId: string,
  input: string,
): Promise<void> {
  await invoke('steer_codex_rpc_turn', {
    params: { sessionId, turnId, input },
  });
}

// ---------------------------------------------------------------------------
// Code review (Phase 5)
// ---------------------------------------------------------------------------

export interface ReviewStartResponse {
  review_id?: string;
  [key: string]: unknown;
}

/** Start a code review via the codex app-server */
export async function startCodexReview(
  sessionId: string,
  threadId: string,
  instruction?: string,
): Promise<ReviewStartResponse> {
  return invoke('start_codex_rpc_review', {
    params: { sessionId, threadId, instruction },
  });
}

// ---------------------------------------------------------------------------
// Skills (Phase 5)
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string;
  path?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/** List skills via the codex app-server */
export async function listCodexSkills(
  sessionId: string,
  cwd?: string,
): Promise<SkillInfo[]> {
  return invoke('list_codex_rpc_skills', {
    params: { sessionId, cwd },
  });
}

// ---------------------------------------------------------------------------
// Dynamic tool response (Phase 5)
// ---------------------------------------------------------------------------

/** Respond to a dynamic tool call server request */
export async function respondCodexDynamicTool(
  sessionId: string,
  requestId: number,
  result: unknown,
): Promise<void> {
  await invoke('respond_codex_rpc_dynamic_tool', {
    params: { sessionId, requestId, result },
  });
}
