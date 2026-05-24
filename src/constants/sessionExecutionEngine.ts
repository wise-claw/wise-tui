export type SessionExecutionEngine = "claude" | "codex";

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
};

export function normalizeSessionExecutionEngine(
  raw: string | null | undefined,
): SessionExecutionEngine {
  return raw?.trim().toLowerCase() === "codex" ? "codex" : "claude";
}
