import { checkWiseUpdate } from "../services/appUpdateCheck";
import { useEffect } from "react";
import { App } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import {
  APP_UPDATE_STARTUP_DELAY_MS,
  createAppUpdateAutoChecker,
} from "../services/appUpdateAutoCheck";
import { APP_UPDATE_AUTO_CHECK_CHANGED, loadAppUpdateAutoCheck } from "../services/appUpdatePreferences";

/** 主窗口启动后检查，前台每六小时复查；恢复前台 / 网络后补查到期的任务。 */
export function useAppUpdateAutoCheck() {
  const { notification, modal } = App.useApp();
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let ready = false;
    let preferenceRevision = 0;
    const checker = createAppUpdateAutoChecker({
      check: async () => {
        const result = await checkWiseUpdate();
        if (result.kind === "current") return null;
        if (result.kind === "manual") return { version: result.version, body: result.body };
        try { return { version: result.update.version, body: result.update.body }; }
        finally { await result.update.close(); }
      },
      onAvailable: (update) => {
        notification.info({
          key: "wise-app-update",
          title: `Wise ${update.version} 可更新`,
          description: "点击查看更新说明并下载安装。",
          duration: 0,
          onClick: () => {
            void import("../components/DefaultConfigPanel/AppUpdateSection").then(({ AppUpdateSection }) => {
              if (disposed) return;
              notification.destroy("wise-app-update");
              modal.info({ title: "版本更新", content: <AppUpdateSection checkOnOpen />, width: 640, icon: null });
            }).catch(() => {});
          },
        });
      },
    });
    const tick = () => {
      if (ready && document.visibilityState !== "hidden" && navigator.onLine !== false) void checker.tick();
    };
    const changed = (event: Event) => {
      preferenceRevision++;
      const enabled = (event as CustomEvent<boolean>).detail;
      checker.setEnabled(enabled);
      if (!enabled) notification.destroy("wise-app-update");
      else tick();
    };
    void loadAppUpdateAutoCheck().then((enabled) => {
      if (!disposed && preferenceRevision === 0) { checker.setEnabled(enabled); tick(); }
    });
    const startup = setTimeout(() => { ready = true; tick(); }, APP_UPDATE_STARTUP_DELAY_MS);
    const interval = setInterval(tick, 60000);
    window.addEventListener(APP_UPDATE_AUTO_CHECK_CHANGED, changed);
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      disposed = true;
      checker.stop();
      clearTimeout(startup);
      clearInterval(interval);
      window.removeEventListener(APP_UPDATE_AUTO_CHECK_CHANGED, changed);
      window.removeEventListener("online", tick);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
      notification.destroy("wise-app-update");
    };
  }, [notification, modal]);
}

/** 必须挂载在工作台现有的 AntdApp Provider 内，以取得有效通知实例。 */
export function AppUpdateAutoCheck() {
  useAppUpdateAutoCheck();
  return null;
}
