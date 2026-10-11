import { getAppSetting, setAppSetting } from "./appSettingsStore";

const KEY = "wise.appUpdate.autoCheck.v1";
export const APP_UPDATE_AUTO_CHECK_CHANGED = "wise-app-update-auto-check-changed";

export async function loadAppUpdateAutoCheck(): Promise<boolean> {
  return (await getAppSetting(KEY)) !== "false";
}

export async function saveAppUpdateAutoCheck(enabled: boolean): Promise<void> {
  await setAppSetting(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent(APP_UPDATE_AUTO_CHECK_CHANGED, { detail: enabled }));
}
