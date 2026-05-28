import { useEffect } from "react";
import { ensureMacTerminalsDetected, isMacPlatform } from "../services/macosTerminal";
import { hydrateTerminalAppPreference } from "../services/terminalAppPreference";

/** 应用启动时在 macOS 上预加载终端检测结果与已保存偏好。 */
export function useMacTerminalDetectionBootstrap(): void {
  useEffect(() => {
    if (!isMacPlatform()) return;
    void (async () => {
      await ensureMacTerminalsDetected();
      await hydrateTerminalAppPreference();
    })();
  }, []);
}
