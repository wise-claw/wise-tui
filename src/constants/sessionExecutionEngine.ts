export type SessionExecutionEngine =
  | "claude"
  | "codex"
  | "codex-rpc"
  | "cursor"
  | "gemini"
  | "opencode"
  | "qoder";

export const SESSION_EXECUTION_ENGINE_LABELS: Record<
  SessionExecutionEngine,
  { title: string; short: string; description: string }
> = {
  claude: {
    title: "Claude Code",
    short: "Claude",
    description: "Anthropic Claude Code CLI（默认）",
  },
  codex: {
    title: "Codex CLI",
    short: "Codex",
    description: "OpenAI Codex CLI（codex exec）",
  },
  "codex-rpc": {
    title: "Codex RPC",
    short: "Codex RPC",
    description: "OpenAI Codex App-Server JSON-RPC",
  },
  cursor: {
    title: "Cursor Agent",
    short: "Cursor",
    description: "Cursor Agent ACP（agent acp）",
  },
  gemini: {
    title: "Gemini CLI",
    short: "Gemini",
    description: "Google Gemini CLI（gemini）",
  },
  opencode: {
    title: "OpenCode",
    short: "OpenCode",
    description: "OpenCode CLI（opencode）",
  },
  qoder: {
    title: "Qoder CLI",
    short: "Qoder",
    description: "Qoder CLI（qodercli -p）",
  },
};

export const SESSION_EXECUTION_ENGINES = [
  "claude",
  "codex",
  "codex-rpc",
  "cursor",
  "gemini",
  "opencode",
  "qoder",
] as const satisfies readonly SessionExecutionEngine[];

export function normalizeSessionExecutionEngine(
  raw: string | null | undefined,
): SessionExecutionEngine {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "codex-rpc") return "codex-rpc";
  if (normalized === "cursor") return "cursor";
  if (normalized === "gemini") return "gemini";
  if (normalized === "opencode") return "opencode";
  if (normalized === "qoder") return "qoder";
  return "claude";
}

export function isSessionExecutionEngine(value: string): value is SessionExecutionEngine {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "codex-rpc" ||
    value === "cursor" ||
    value === "gemini" ||
    value === "opencode" ||
    value === "qoder"
  );
}
