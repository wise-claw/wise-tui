import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { DynamicIslandNotifications } from "./components/DynamicIsland/DynamicIslandNotifications";
import { useCompletionToasts } from "./hooks/useCompletionToasts";
import { useHudClickThrough } from "./hooks/useHudClickThrough";
import { wiseIslandOpenSession } from "./services/wiseIsland";
import { ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";
import "./island.css";

ensureTauriEventUnlistenPatched();

function DynamicIslandApp() {
  const { toasts, queuedCount, renderedCount, deliveryRevision, dismiss } = useCompletionToasts(true);
  useHudClickThrough();
  useEffect(() => {
    if (renderedCount !== 0 || deliveryRevision === 0) return;
    void invoke("wise_island_completion_hide", { revision: deliveryRevision }).catch(console.error);
  }, [renderedCount, deliveryRevision]);
  return (
    <main className="app-island-window" aria-label="Wise 灵动岛">
      <DynamicIslandNotifications toasts={toasts} queuedCount={queuedCount} onDismiss={dismiss}
        onSelect={(sessionId, toastId) => {
          void wiseIslandOpenSession(sessionId).then(() => dismiss(toastId)).catch(console.error);
        }} />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<DynamicIslandApp />);
