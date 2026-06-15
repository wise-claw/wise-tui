import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ClaudeLlmProxyStatus } from "../services/claudeLlmProxy";
import type { FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import type { OpencodeGoProxyStatus } from "../services/opencodeGoProxy";
import { resolveAnthropicProxyConflict } from "./anthropicProxyConflict";

export const COMPOSER_PROXY_LABELS = {
  opencodeGo: "OpenCode 代理",
  llmProxy: "LLM 代理",
  fcc: "FCC 代理",
} as const;

/** 与 `claude_commands` / `codex_commands` spawn 注入顺序一致，解析 Composer 底栏应展示的代理名。 */
export function resolveComposerActiveProxyLabel(
  engine: SessionExecutionEngine,
  opencodeGo:
    | Pick<
        OpencodeGoProxyStatus,
        "enabled" | "running" | "claudeSettingsAligned" | "codexSettingsAligned"
      >
    | null
    | undefined,
  llmProxy: Pick<ClaudeLlmProxyStatus, "listening" | "running"> | null | undefined,
  fcc:
    | Pick<FreeClaudeCodeStatus, "serverRunning" | "claudeSettingsAligned">
    | null
    | undefined,
): string | null {
  const view = resolveAnthropicProxyConflict(opencodeGo, llmProxy, fcc);

  if (engine === "codex") {
    if (view.opencodeGoActive) {
      return COMPOSER_PROXY_LABELS.opencodeGo;
    }
    return null;
  }

  if (engine === "claude") {
    if (view.claudeSpawnOwner === "opencode-go") {
      return COMPOSER_PROXY_LABELS.opencodeGo;
    }
    if (view.claudeSpawnOwner === "llm-proxy") {
      return COMPOSER_PROXY_LABELS.llmProxy;
    }
    if (fcc?.serverRunning && fcc.claudeSettingsAligned) {
      return COMPOSER_PROXY_LABELS.fcc;
    }
    return null;
  }

  return null;
}
