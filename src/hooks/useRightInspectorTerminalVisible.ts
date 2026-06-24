import { useCallback, useEffect, useState } from "react";
import {
  loadRightInspectorTerminalVisibleFromStore,
  WISE_RIGHT_INSPECTOR_TERMINAL_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 右栏顶部独立终端面板是否显示（`wise.defaultConfig.v1.showRightInspectorTerminal`）。 */
export function useRightInspectorTerminalVisible(): boolean {
  const [visible, setVisible] = useState(false);

  const apply = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRightInspectorTerminalVisibleFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ visible?: boolean }>).detail?.visible;
      if (typeof next === "boolean") {
        setVisible(next);
      }
    };
    window.addEventListener(WISE_RIGHT_INSPECTOR_TERMINAL_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_RIGHT_INSPECTOR_TERMINAL_CHANGED, onChanged);
    };
  }, [apply]);

  return visible;
}
