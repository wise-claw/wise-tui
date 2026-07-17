export type SessionExecutionEngine =
  | "claude"
  | "codex"
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
  cursor: {
    title: "Cursor CLI",
    short: "Cursor",
    description: "Cursor Agent CLI（agent -p）",
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
    value === "cursor" ||
    value === "gemini" ||
    value === "opencode" ||
    value === "qoder"
  );
}
