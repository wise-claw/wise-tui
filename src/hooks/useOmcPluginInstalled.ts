import { useCallback, useEffect, useState } from "react";
import { isOmcPluginInstalled } from "../services/claude";

export function useOmcPluginInstalled(active = true) {
  const [omcInstalled, setOmcInstalled] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const installed = await isOmcPluginInstalled();
      setOmcInstalled(installed);
      return installed;
    } catch {
      setOmcInstalled(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  return { omcInstalled, refreshOmcInstalled: refresh };
}
