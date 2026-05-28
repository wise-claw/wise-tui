import { deleteAppSetting, getAppSetting, setAppSetting } from "./appSettingsStore";
import {
  ensureMacTerminalsDetected,
  getDetectedMacTerminalsSync,
  isTerminalOpenAppId,
  type DetectedMacTerminal,
} from "./macosTerminal";

const TERMINAL_APP_SETTING_KEY = "wise.ui.default-terminal.v1";

let currentTerminalAppId: string | null = null;
let hydrated = false;
let hydrating = false;

export function getTerminalAppPreferenceSync(): string | null {
  return currentTerminalAppId;
}

export function resolveStoredTerminalOpenTarget(): DetectedMacTerminal | null {
  const detected = getDetectedMacTerminalsSync();
  if (detected.length === 0) return null;
  const preferredId = currentTerminalAppId?.trim();
  if (preferredId) {
    const hit = detected.find((item) => item.id === preferredId);
    if (hit) return hit;
  }
  return detected[0] ?? null;
}

export async function hydrateTerminalAppPreference(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  await ensureMacTerminalsDetected();
  const stored = (await getAppSetting(TERMINAL_APP_SETTING_KEY))?.trim();
  if (stored && getDetectedMacTerminalsSync().some((item) => item.id === stored)) {
    currentTerminalAppId = stored;
  } else if (stored) {
    currentTerminalAppId = null;
    await deleteAppSetting(TERMINAL_APP_SETTING_KEY);
  }
  hydrated = true;
  hydrating = false;
}

export async function setTerminalAppPreference(id: string): Promise<void> {
  const normalized = id.trim();
  if (!normalized || !isTerminalOpenAppId(normalized)) return;
  currentTerminalAppId = normalized;
  await setAppSetting(TERMINAL_APP_SETTING_KEY, normalized);
}
