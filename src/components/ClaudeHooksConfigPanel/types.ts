import type { ClaudeHookHandler, ClaudeHookSourceScope } from "../../types";

export interface ClaudeHooksConfigPanelHandle {
  refresh: () => Promise<void>;
  openCreateModal: () => void;
}

export type HooksFlowTheme = "neon-blue" | "cyber-purple" | "light-tech";

export type EditingTarget = {
  scope: ClaudeHookSourceScope;
  eventName: string;
  groupId: string;
  handlerId: string;
} | null;

export type HookFlowEntry = {
  scope: ClaudeHookSourceScope;
  eventName: string;
  groupId: string;
  handlerId: string;
  matcher: string;
  type: ClaudeHookHandler["type"];
  summary: string;
};

export interface HookEditFormValues {
  scope: ClaudeHookSourceScope;
  eventName: string;
  matcher?: string;
  type: ClaudeHookHandler["type"];
  if?: string;
  timeout?: number;
  statusMessage?: string;
  shell?: "bash" | "powershell";
  async?: boolean;
  asyncRewake?: boolean;
  command?: string;
  url?: string;
  headersText?: string;
  allowedEnvVarsText?: string;
  prompt?: string;
  model?: string;
}

export interface HookImportFormValues {
  scope: ClaudeHookSourceScope;
  mode: "append" | "overwrite_event";
  payload: string;
}
