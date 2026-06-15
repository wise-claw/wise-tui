import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../constants/sessionExecutionEngine";
import type { ClaudeLlmProxyStatus } from "../services/claudeLlmProxy";
import type { FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import type { OpencodeGoProxyStatus } from "../services/opencodeGoProxy";
import { resolveAnthropicProxyConflict } from "./anthropicProxyConflict";

export const COMPOSER_PROXY_LABELS = {
  opencodeGo: "OpenCode 代理",
  llmProxy: "LLM 代理",
  fcc: "FCC 代理",
} as const;

export type ComposerProxyRouteKind = "opencode-go" | "llm-proxy" | "fcc";

export interface ComposerActiveProxyRoute {
  label: string;
  kind: "opencode-go" | "llm-proxy" | "fcc";
  needsAttention: boolean;
  attentionMessage: string | null;
  detail: string;
  tooltip: string;
}

function opencodeRouteDetail(st: Pick<OpencodeGoProxyStatus, "proxyBaseUrl" | "port" | "defaultModel">): string {
  const base = st.proxyBaseUrl?.trim() || `127.0.0.1:${st.port > 0 ? st.port : 9876}`;
  const model = st.defaultModel?.trim();
  return model ? `${base} → ${model}` : base;
}

function llmRouteDetail(st: Pick<ClaudeLlmProxyStatus, "localProxyUrl" | "port" | "upstream">): string {
  const local = st.localProxyUrl?.trim() || (st.port ? `127.0.0.1:${st.port}` : "本地监听");
  const upstream = st.upstream?.trim();
  return upstream ? `${local} → ${upstream}` : local;
}

function fccRouteDetail(st: Pick<FreeClaudeCodeStatus, "proxyBaseUrl" | "model">): string {
  const base = st.proxyBaseUrl?.trim() || "FCC";
  const model = st.model?.trim();
  return model ? `${base} → ${model}` : base;
}

function buildRouteTooltip(
  engine: SessionExecutionEngine,
  route: Pick<ComposerActiveProxyRoute, "label" | "detail" | "attentionMessage">,
  modelLabel: string | null,
): string {
  const engineTitle = SESSION_EXECUTION_ENGINE_LABELS[engine].title;
  const parts = [
    `${engineTitle} 经 ${route.label} 路由`,
    route.detail,
  ];
  if (modelLabel?.trim()) {
    parts.push(`模型：${modelLabel.trim()}`);
  }
  if (route.attentionMessage) {
    parts.push(route.attentionMessage);
  }
  parts.push("点击切换模型或执行环境");
  return parts.join("\n");
}

/** 与 spawn 注入顺序一致：解析当前执行引擎实际经行的 Wise 内置代理。 */
export function resolveComposerActiveProxyRoute(
  engine: SessionExecutionEngine,
  opencodeGo:
    | Pick<
        OpencodeGoProxyStatus,
        | "enabled"
        | "running"
        | "claudeSettingsAligned"
        | "codexSettingsAligned"
        | "proxyBaseUrl"
        | "port"
        | "defaultModel"
      >
    | null
    | undefined,
  llmProxy:
    | Pick<ClaudeLlmProxyStatus, "listening" | "running" | "localProxyUrl" | "port" | "upstream">
    | null
    | undefined,
  fcc:
    | Pick<FreeClaudeCodeStatus, "serverRunning" | "claudeSettingsAligned" | "proxyBaseUrl" | "model">
    | null
    | undefined,
  options?: { modelLabel?: string | null },
): ComposerActiveProxyRoute | null {
  const view = resolveAnthropicProxyConflict(opencodeGo, llmProxy, fcc);
  const modelLabel = options?.modelLabel ?? null;

  if (engine === "codex") {
    if (!view.opencodeGoActive || !opencodeGo) {
      return null;
    }
    const needsAttention = !opencodeGo.codexSettingsAligned;
    const route = {
      label: COMPOSER_PROXY_LABELS.opencodeGo,
      kind: "opencode-go" as const,
      needsAttention,
      attentionMessage: needsAttention ? "Codex config 尚未对齐，请在顶栏 OpenCode 代理中同步" : null,
      detail: opencodeRouteDetail(opencodeGo),
    };
    return {
      ...route,
      tooltip: buildRouteTooltip(engine, route, modelLabel),
    };
  }

  if (engine === "claude") {
    if (view.claudeSpawnOwner === "opencode-go" && opencodeGo) {
      const needsAttention = !opencodeGo.claudeSettingsAligned;
      const route = {
        label: COMPOSER_PROXY_LABELS.opencodeGo,
        kind: "opencode-go" as const,
        needsAttention,
        attentionMessage: needsAttention
          ? "Claude settings 尚未对齐，请在顶栏 OpenCode 代理中同步"
          : null,
        detail: opencodeRouteDetail(opencodeGo),
      };
      return {
        ...route,
        tooltip: buildRouteTooltip(engine, route, modelLabel),
      };
    }
    if (view.claudeSpawnOwner === "llm-proxy" && llmProxy) {
      const route = {
        label: COMPOSER_PROXY_LABELS.llmProxy,
        kind: "llm-proxy" as const,
        needsAttention: false,
        attentionMessage: null,
        detail: llmRouteDetail(llmProxy),
      };
      return {
        ...route,
        tooltip: buildRouteTooltip(engine, route, modelLabel),
      };
    }
    if (fcc?.serverRunning && fcc.claudeSettingsAligned) {
      const route = {
        label: COMPOSER_PROXY_LABELS.fcc,
        kind: "fcc" as const,
        needsAttention: false,
        attentionMessage: null,
        detail: fccRouteDetail(fcc),
      };
      return {
        ...route,
        tooltip: buildRouteTooltip(engine, route, modelLabel),
      };
    }
  }

  return null;
}

/** @deprecated 使用 resolveComposerActiveProxyRoute */
export function resolveComposerActiveProxyLabel(
  engine: SessionExecutionEngine,
  opencodeGo: Parameters<typeof resolveComposerActiveProxyRoute>[1],
  llmProxy: Parameters<typeof resolveComposerActiveProxyRoute>[2],
  fcc: Parameters<typeof resolveComposerActiveProxyRoute>[3],
): string | null {
  return resolveComposerActiveProxyRoute(engine, opencodeGo, llmProxy, fcc)?.label ?? null;
}
