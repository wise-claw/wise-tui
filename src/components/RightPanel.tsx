/**
 * Backward-compatibility shim.
 *
 * `RightPanel` was renamed to `ChatInspector` and moved to
 * `Inspector/ChatInspector.tsx` during P1 (see宪法 §4 / `agent-harness-architecture.md`).
 *
 * This file re-exports the new symbols under the old names so any leftover
 * imports outside the rename radius still compile. Prefer importing
 * `ChatInspector` directly from `./Inspector` in new code.
 */
export { ChatInspector as RightPanel, type ChatInspectorProps as RightPanelProps } from "./Inspector/ChatInspector";
