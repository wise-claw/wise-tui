import { mountRenderedMermaidDiagram } from "./mermaidViewerUi";
import {
  buildMermaidRenderAttempts,
  normalizeMermaidSourceForRender,
  type MermaidRenderAttempt,
} from "./mermaidSourceNormalize";

type MermaidModule = typeof import("mermaid");

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let initializedKey: string | null = null;

function resolveMermaidTheme(): "default" | "dark" {
  if (typeof document === "undefined") return "default";
  if (document.documentElement.getAttribute("data-theme") === "dark") return "dark";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

function buildMermaidThemeConfig(
  theme: "default" | "dark",
  htmlLabels: boolean,
  securityLevel: "loose" | "sandbox",
) {
  const shared = {
    startOnLoad: false,
    securityLevel,
    suppressErrorRendering: true,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 13,
    theme: "base" as const,
    flowchart: {
      htmlLabels,
      curve: "basis" as const,
      padding: 18,
      nodeSpacing: 48,
      rankSpacing: 56,
      diagramPadding: 12,
      useMaxWidth: false,
    },
  };

  if (theme === "dark") {
    return {
      ...shared,
      themeVariables: {
        background: "#141414",
        primaryColor: "#1f1f1f",
        primaryTextColor: "#f0f0f0",
        primaryBorderColor: "#424242",
        secondaryColor: "#262626",
        tertiaryColor: "#1a1a1a",
        lineColor: "#bfbfbf",
        textColor: "#f0f0f0",
        mainBkg: "#1f1f1f",
        nodeBorder: "#595959",
        clusterBkg: "#1a1a1a",
        clusterBorder: "#434343",
        titleColor: "#f0f0f0",
        edgeLabelBackground: "#141414",
      },
    };
  }

  return {
    ...shared,
    themeVariables: {
      background: "#ffffff",
      primaryColor: "#fafafa",
      primaryTextColor: "#262626",
      primaryBorderColor: "#d9d9d9",
      secondaryColor: "#f5f5f5",
      tertiaryColor: "#f0f0f0",
      lineColor: "#8c8c8c",
      textColor: "#262626",
      mainBkg: "#ffffff",
      nodeBorder: "#d9d9d9",
      clusterBkg: "#fafafa",
      clusterBorder: "#d9d9d9",
      titleColor: "#434343",
      edgeLabelBackground: "#ffffff",
    },
  };
}

async function loadMermaidModule(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid");
  }
  return mermaidModulePromise;
}

async function ensureMermaidInitialized(attempt: MermaidRenderAttempt): Promise<MermaidModule["default"]> {
  const mod = await loadMermaidModule();
  const theme = resolveMermaidTheme();
  const key = `${theme}:${attempt.htmlLabels}:${attempt.securityLevel}`;
  if (initializedKey !== key) {
    mod.default.initialize(
      buildMermaidThemeConfig(theme, attempt.htmlLabels, attempt.securityLevel),
    );
    initializedKey = key;
  }
  return mod.default;
}

function nextMermaidRenderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `wise-mermaid-${crypto.randomUUID()}`;
  }
  return `wise-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createHiddenRenderHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "app-markdown-mermaid__render-host";
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "1px";
  host.style.height = "1px";
  host.style.overflow = "hidden";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);
  return host;
}

function formatMermaidRenderError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().split("\n").slice(0, 2).join(" · ");
  }
  return "语法无法解析";
}

async function renderMermaidAttempt(
  mermaid: MermaidModule["default"],
  attempt: MermaidRenderAttempt,
): Promise<string> {
  const host = createHiddenRenderHost();
  try {
    const { svg } = await mermaid.render(nextMermaidRenderId(), attempt.source, host);
    return svg;
  } finally {
    host.remove();
  }
}

async function tryRenderMermaidDiagram(source: string): Promise<string> {
  const attempts = buildMermaidRenderAttempts(source);
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const mermaid = await ensureMermaidInitialized(attempt);
      return await renderMermaidAttempt(mermaid, attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Mermaid render failed");
}

function showMermaidRenderError(
  block: HTMLElement,
  sourceEl: HTMLElement | null,
  detail: string,
): void {
  block.classList.add("app-markdown-mermaid--error");
  block.setAttribute("data-mermaid-rendered", "error");
  block.setAttribute("aria-label", "流程图渲染失败");
  const status = document.createElement("div");
  status.className = "app-markdown-mermaid__error";
  status.textContent = "流程图无法渲染，已显示源码";
  const hint = document.createElement("div");
  hint.className = "app-markdown-mermaid__error-detail";
  hint.textContent = detail;
  if (sourceEl) {
    sourceEl.hidden = false;
    block.replaceChildren(status, hint, sourceEl);
  } else {
    block.replaceChildren(status, hint);
  }
}

/** 将容器内待渲染的 Mermaid 占位块渲染为 SVG。 */
export async function renderMermaidInContainer(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>(
    ".app-markdown-mermaid:not([data-mermaid-rendered])",
  );
  if (blocks.length === 0) return;

  for (const block of blocks) {
    if (!block.isConnected) continue;
    const sourceEl = block.querySelector<HTMLElement>(".app-markdown-mermaid__source");
    const rawSource = sourceEl?.textContent?.trim() ?? "";
    if (!rawSource) {
      block.setAttribute("data-mermaid-rendered", "empty");
      continue;
    }

    try {
      const svg = await tryRenderMermaidDiagram(rawSource);
      if (!block.isConnected) continue;
      mountRenderedMermaidDiagram(block, svg);
    } catch (error) {
      if (!block.isConnected) continue;
      showMermaidRenderError(block, sourceEl, formatMermaidRenderError(error));
    }
  }
}

/** 测试/主题切换时重置 lazy 初始化状态。 */
export function resetMermaidRenderStateForTests(): void {
  mermaidModulePromise = null;
  initializedKey = null;
}

export { normalizeMermaidSourceForRender };
