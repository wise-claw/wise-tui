/**
 * 在 Wise 主窗口内模拟 VS Code Webview 的 `acquireVsCodeApi()`，将 postMessage 交给 CC Workflow Studio 宿主。
 */

const STORAGE_PREFIX = "wise-cc-wf-studio:";

export interface WiseVsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

type WebviewInboundHandler = (message: unknown) => void;

let inboundHandler: WebviewInboundHandler | null = null;
let storageNamespace = "default";

function storageKey(suffix: string): string {
  return `${STORAGE_PREFIX}${storageNamespace}:${suffix}`;
}

export function registerCcWfStudioWebviewHandler(handler: WebviewInboundHandler | null, namespace: string) {
  inboundHandler = handler;
  storageNamespace = namespace || "default";
}

export function createWiseVsCodeApi(): WiseVsCodeApi {
  return {
    postMessage(message: unknown) {
      if (inboundHandler) {
        inboundHandler(message);
      } else {
        console.warn("[cc-wf-studio] postMessage before host registered", message);
      }
    },
    getState() {
      try {
        const raw = sessionStorage.getItem(storageKey("state"));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    setState(state: unknown) {
      try {
        sessionStorage.setItem(storageKey("state"), JSON.stringify(state ?? null));
      } catch {
        /* ignore quota */
      }
    },
  };
}

/** 宿主 → Webview：对齐真实 Extension 的 postMessage，便于 Tauri/WebKit 触发 message 监听。 */
export function emitExtensionToWebviewMessage(data: unknown) {
  try {
    window.postMessage(data, "*");
  } catch {
    window.dispatchEvent(new MessageEvent("message", { data }));
  }
}
