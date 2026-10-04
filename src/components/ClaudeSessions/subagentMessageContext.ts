import { createContext, useContext } from "react";
import type { ToolUsePart } from "../../types";

export const SubagentMessageContext = createContext<((part: ToolUsePart) => void) | null>(null);

export function useOpenSubagentMessages() {
  return useContext(SubagentMessageContext);
}
