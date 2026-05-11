import { invoke } from "@tauri-apps/api/core";
import type { Repository, SddMode } from "../../types";

export interface SddSignals {
  hasTrellisTasks: boolean;
  hasTrellisSpec: boolean;
  hasOpenSpec: boolean;
  hasGenericSpec: boolean;
}

export async function detectSddSignals(repoPath: string): Promise<SddSignals> {
  return invoke<SddSignals>("trellis_detect_sdd_signals", { repoPath });
}

export function resolveAutoSddMode(signals: SddSignals): SddMode {
  if (signals.hasTrellisTasks || signals.hasTrellisSpec) return "project_owned";
  if (signals.hasOpenSpec || signals.hasGenericSpec) return "project_owned";
  return "wise_trellis";
}

export function effectiveSddMode(repository: Repository, signals: SddSignals): SddMode {
  const explicit = repository.sddMode;
  if (explicit && explicit !== "auto") return explicit;
  return resolveAutoSddMode(signals);
}
