import { deleteAppSetting, getAppSetting, setAppSetting } from "./appSettingsStore";
import { DEFAULT_OPEN_APP_ID, OPEN_APP_STORAGE_KEY } from "../components/OpenAppMenu/constants";

const OPEN_APP_SETTING_KEY = "wise.ui.open-app.v1";
let currentOpenAppId = DEFAULT_OPEN_APP_ID;
let hydrated = false;
let hydrating = false;

export function getOpenAppPreferenceSync(): string {
  return currentOpenAppId;
}

export async function hydrateOpenAppPreference(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  const normalized = (await getAppSetting(OPEN_APP_SETTING_KEY))?.trim();
  if (normalized) {
    currentOpenAppId = normalized;
  } else {
    const legacy = (await getAppSetting(OPEN_APP_STORAGE_KEY))?.trim();
    if (legacy) {
      currentOpenAppId = legacy;
      await setAppSetting(OPEN_APP_SETTING_KEY, legacy);
      await deleteAppSetting(OPEN_APP_STORAGE_KEY);
    }
  }
  hydrated = true;
  hydrating = false;
}

export async function setOpenAppPreference(id: string): Promise<void> {
  const normalized = id.trim();
  if (!normalized) return;
  currentOpenAppId = normalized;
  await setAppSetting(OPEN_APP_SETTING_KEY, normalized);
}
