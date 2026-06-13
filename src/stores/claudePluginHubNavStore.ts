export type ClaudePluginHubTab = "catalog" | "installed";

type Listener = () => void;

let requestedTab: ClaudePluginHubTab | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function subscribeClaudePluginHubNav(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClaudePluginHubNavSnapshot(): ClaudePluginHubTab | null {
  return requestedTab;
}

export function requestClaudePluginHubTab(tab: ClaudePluginHubTab): void {
  requestedTab = tab;
  notify();
}

export function consumeClaudePluginHubTab(): ClaudePluginHubTab | null {
  const tab = requestedTab;
  requestedTab = null;
  return tab;
}
