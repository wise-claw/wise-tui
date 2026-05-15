import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type WiseWorkflowPortalContextValue = {
  /** Radix Portal 挂载的 DOM；在挂载点前保持 null，禁止回退到 document.body 以免蒙层盖全窗 */
  hostElement: HTMLElement | null;
  setHostElement: (el: HTMLElement | null) => void;
};

const WiseWorkflowPortalContext = createContext<WiseWorkflowPortalContextValue | null>(null);

export function WiseWorkflowPortalProvider({ children }: { children: ReactNode }) {
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null);
  const setHostElementStable = useCallback((el: HTMLElement | null) => {
    setHostElement((prev) => (prev === el ? prev : el));
  }, []);
  const value = useMemo(
    () => ({ hostElement, setHostElement: setHostElementStable }),
    [hostElement, setHostElementStable],
  );
  return (
    <WiseWorkflowPortalContext.Provider value={value}>{children}</WiseWorkflowPortalContext.Provider>
  );
}

/** 在工作流 Studio 壳内时为非 null Context；否则为 null（Portal 可回退 body）。 */
export function useWiseWorkflowPortalContextValue(): WiseWorkflowPortalContextValue | null {
  return useContext(WiseWorkflowPortalContext);
}
