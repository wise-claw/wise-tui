import type { TaskSplitSnapshot } from "../types";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./appSettingsStore";

const STORAGE_KEY = "wise.prdTaskSplit.snapshots.v1";

interface SnapshotStorePayload {
  snapshots: TaskSplitSnapshot[];
  currentVersion: number;
}

export async function saveTaskSnapshots(payload: SnapshotStorePayload): Promise<void> {
  await setAppSetting(STORAGE_KEY, JSON.stringify(payload));
}

export async function loadTaskSnapshots(): Promise<SnapshotStorePayload | null> {
  try {
    const raw = await getAppSetting(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotStorePayload;
    if (!Array.isArray(parsed.snapshots)) return null;
    if (typeof parsed.currentVersion !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearTaskSnapshots(): Promise<void> {
  await deleteAppSetting(STORAGE_KEY);
}
