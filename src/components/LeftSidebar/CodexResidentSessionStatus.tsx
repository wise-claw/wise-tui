import type { ClaudeSession } from "../../types";
import { useCodexPersistentSessionSelected } from "../../hooks/useCodexPersistentSession";

export function CodexResidentSessionStatus({ session }: {
  session: Pick<ClaudeSession, "id" | "status" | "executionEngine">;
}) {
  const selected = useCodexPersistentSessionSelected(session.id);
  const codex = !session.executionEngine || session.executionEngine === "codex" || session.executionEngine === "codex-rpc";
  const visible = codex && selected;
  if (!visible) return null;
  return <span className="app-workspace-session-tree__resident"
    title="已开启常驻" aria-label="已开启常驻">常驻</span>;
}
