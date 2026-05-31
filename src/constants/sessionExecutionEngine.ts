export type SessionExecutionEngine = "claude" | "codex" | "cursor";

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
    title: "Cursor SDK",
    short: "Cursor",
    description: "Cursor SDK Local Agent（可编程引擎）",
  },
};

export const SESSION_EXECUTION_ENGINES = ["claude", "codex", "cursor"] as const satisfies readonly SessionExecutionEngine[];

export function normalizeSessionExecutionEngine(
  raw: string | null | undefined,
): SessionExecutionEngine {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "cursor") return "cursor";
  return "claude";
}

export function isSessionExecutionEngine(value: string): value is SessionExecutionEngine {
  return value === "claude" || value === "codex" || value === "cursor";
}
