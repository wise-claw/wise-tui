import { useCallback } from "react";
import { setChromePanelHovered } from "../stores/chromePanelHoverStore";

export function useChromePanelHoverHandlers(panel: "left" | "right") {
  const onMouseEnter = useCallback(() => {
    setChromePanelHovered(panel, true);
  }, [panel]);
  const onMouseLeave = useCallback(() => {
    setChromePanelHovered(panel, false);
  }, [panel]);
  return { onMouseEnter, onMouseLeave };
}
