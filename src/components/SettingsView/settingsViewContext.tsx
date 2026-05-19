import { createContext, useContext, type ReactNode } from "react";

export type SettingsViewMode = "modal" | "page";

const SettingsViewModeContext = createContext<SettingsViewMode | null>(null);

interface ProviderProps {
  value: SettingsViewMode;
  children: ReactNode;
}

export function SettingsViewModeProvider({ value, children }: ProviderProps) {
  return (
    <SettingsViewModeContext.Provider value={value}>{children}</SettingsViewModeContext.Provider>
  );
}

export function useSettingsViewMode(): SettingsViewMode {
  const v = useContext(SettingsViewModeContext);
  if (v == null) {
    throw new Error("useSettingsViewMode must be used inside <SettingsViewModeProvider>");
  }
  return v;
}
