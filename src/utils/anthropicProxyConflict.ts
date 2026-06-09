import type { ClaudeLlmProxyStatus } from "../services/claudeLlmProxy";
import type { FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import type { OpencodeGoProxyStatus } from "../services/opencodeGoProxy";

export type ClaudeAnthropicBaseUrlOwner = "opencode-go" | "llm-proxy" | "none";

export interface AnthropicProxyConflictView {
  opencodeGoActive: boolean;
  llmProxyActive: boolean;
  /** @deprecated 使用 opencodeLlmBothActive */
  bothActive: boolean;
  opencodeLlmBothActive: boolean;
  fccServerRunning: boolean;
  fccClaudeSettingsAligned: boolean;
  opencodeClaudeSettingsAligned: boolean;
  /** OpenCode 代理运行中且 FCC 仍在跑或 settings 仍指向 FCC */
  opencodeFccConflict: boolean;
  /** 与 `claude_commands` spawn 覆盖顺序一致：OpenCode Go 优先于 LLM 监听 */
  claudeSpawnOwner: ClaudeAnthropicBaseUrlOwner;
}

export function resolveAnthropicProxyConflict(
  opencodeGo:
    | Pick<OpencodeGoProxyStatus, "enabled" | "running" | "claudeSettingsAligned">
    | null
    | undefined,
  llmProxy: Pick<ClaudeLlmProxyStatus, "listening" | "running"> | null | undefined,
  fcc:
    | Pick<FreeClaudeCodeStatus, "serverRunning" | "claudeSettingsAligned">
    | null
    | undefined = null,
): AnthropicProxyConflictView {
  const opencodeGoActive = Boolean(opencodeGo?.enabled && opencodeGo?.running);
  const llmProxyActive = Boolean(llmProxy?.listening && llmProxy?.running);
  const fccServerRunning = Boolean(fcc?.serverRunning);
  const fccClaudeSettingsAligned = Boolean(fcc?.claudeSettingsAligned);
  const opencodeClaudeSettingsAligned = Boolean(opencodeGo?.claudeSettingsAligned);
  const opencodeFccConflict =
    opencodeGoActive &&
    (fccServerRunning || (fccClaudeSettingsAligned && !opencodeClaudeSettingsAligned));

  let claudeSpawnOwner: ClaudeAnthropicBaseUrlOwner = "none";
  if (opencodeGoActive) {
    claudeSpawnOwner = "opencode-go";
  } else if (llmProxyActive) {
    claudeSpawnOwner = "llm-proxy";
  }

  const opencodeLlmBothActive = opencodeGoActive && llmProxyActive;

  return {
    opencodeGoActive,
    llmProxyActive,
    bothActive: opencodeLlmBothActive,
    opencodeLlmBothActive,
    fccServerRunning,
    fccClaudeSettingsAligned,
    opencodeClaudeSettingsAligned,
    opencodeFccConflict,
    claudeSpawnOwner,
  };
}

export function anthropicProxyConflictMessages(view: AnthropicProxyConflictView): string[] {
  const messages: string[] = [];

  if (view.opencodeLlmBothActive) {
    messages.push(
      "OpenCode 代理与 LLM 流量监听同时开启时，Claude 子进程的 ANTHROPIC_BASE_URL 将优先指向 OpenCode 代理；LLM 监听面板不会记录这部分 Anthropic 流量。请关闭其一，或仅将 LLM 监听用于观察其它上游。",
    );
  }

  if (view.opencodeGoActive && view.fccServerRunning) {
    messages.push(
      "OpenCode 代理与 FCC 同时运行时，Claude 子进程将优先走 OpenCode 代理（spawn 注入）；FCC 仍在另一端口监听。建议停止 FCC 或关闭 OpenCode 代理，避免双代理并存。",
    );
  }

  if (view.opencodeFccConflict && !view.fccServerRunning) {
    messages.push(
      "Claude settings.json 仍指向 FCC，但 OpenCode 代理已在运行。请点击「同步 Claude 设置」或停止 OpenCode 代理，避免 settings 与实得路由不一致。",
    );
  }

  return messages;
}

export function anthropicProxyConflictMessage(view: AnthropicProxyConflictView): string | null {
  const messages = anthropicProxyConflictMessages(view);
  if (messages.length === 0) {
    return null;
  }
  return messages.join("\n\n");
}
