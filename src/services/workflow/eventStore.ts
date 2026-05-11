import { invoke } from "@tauri-apps/api/core";
import type { WorkflowEventEnvelope, WorkflowRunDTO, WorkflowStore } from "../../types/workflow";
import { deleteAppSetting, getAppSetting } from "../appSettingsStore";

const LEGACY_APP_SETTING_KEY_WORKFLOW_STORE = "wise.workflow.store.v1";
let migrationPromise: Promise<void> | null = null;

interface LegacyPersistedWorkflowStore {
  runs?: Record<string, WorkflowRunDTO>;
  events?: Record<string, WorkflowEventEnvelope[]>;
}

async function migrateLegacyLocalStoreIfNeeded(): Promise<void> {
  const raw = await getAppSetting(LEGACY_APP_SETTING_KEY_WORKFLOW_STORE);
  if (!raw) return;
  let parsed: LegacyPersistedWorkflowStore;
  try {
    parsed = JSON.parse(raw) as LegacyPersistedWorkflowStore;
  } catch {
    await deleteAppSetting(LEGACY_APP_SETTING_KEY_WORKFLOW_STORE);
    return;
  }
  const runs = Object.values(parsed.runs ?? {});
  for (const run of runs) {
    await invoke("set_workflow_run", { run });
  }
  const eventsByRun = parsed.events ?? {};
  for (const runEvents of Object.values(eventsByRun)) {
    for (const event of runEvents ?? []) {
      await invoke("append_workflow_event", { event });
    }
  }
  await deleteAppSetting(LEGACY_APP_SETTING_KEY_WORKFLOW_STORE);
}

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyLocalStoreIfNeeded();
  }
  await migrationPromise;
}

export class LocalWorkflowStore implements WorkflowStore {
  async saveRun(run: WorkflowRunDTO): Promise<void> {
    await ensureMigrated();
    await invoke("set_workflow_run", { run });
  }

  async loadRun(workflowRunId: string): Promise<WorkflowRunDTO | null> {
    await ensureMigrated();
    const loaded = await invoke<WorkflowRunDTO | null>("get_workflow_run", { workflowRunId });
    return loaded ?? null;
  }

  async listRuns(): Promise<WorkflowRunDTO[]> {
    await ensureMigrated();
    const runs = await invoke<WorkflowRunDTO[]>("list_workflow_runs");
    return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async appendEvent(event: WorkflowEventEnvelope): Promise<void> {
    await ensureMigrated();
    await invoke("append_workflow_event", { event });
  }

  async listEvents(workflowRunId: string, options?: { from?: number; until?: number }): Promise<WorkflowEventEnvelope[]> {
    await ensureMigrated();
    const all = await invoke<WorkflowEventEnvelope[]>("list_workflow_events", {
      workflowRunId,
      from: options?.from,
      until: options?.until,
    });
    return all.filter((event) => {
      if (options?.from && event.timestamp < options.from) return false;
      if (options?.until && event.timestamp > options.until) return false;
      return true;
    });
  }
}

