import { useCallback, useMemo, useState } from "react";

export type TerminalTab = {
  id: string;
  title: string;
};

type TerminalTabRecord = TerminalTab & {
  autoNamed: boolean;
};

type UseTerminalTabsOptions = {
  onCloseTerminal?: (terminalId: string) => void;
};

function createTerminalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renumberAutoNamedTabs(tabs: TerminalTabRecord[]): TerminalTabRecord[] {
  let autoNamedIndex = 1;
  let changed = false;
  const nextTabs = tabs.map((tab) => {
    if (!tab.autoNamed) {
      return tab;
    }
    const nextTitle = `Terminal ${autoNamedIndex}`;
    autoNamedIndex += 1;
    if (tab.title === nextTitle) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      title: nextTitle,
    };
  });
  return changed ? nextTabs : tabs;
}

export function useTerminalTabs({
  onCloseTerminal,
}: UseTerminalTabsOptions = {}) {
  const [tabs, setTabs] = useState<TerminalTabRecord[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  const createTerminal = useCallback(() => {
    const id = createTerminalId();
    setTabs((prev) => {
      const nextTabs = renumberAutoNamedTabs([
        ...prev,
        { id, title: "", autoNamed: true },
      ]);
      return nextTabs;
    });
    setActiveTerminalId(id);
    return id;
  }, []);

  const closeTerminal = useCallback(
    (terminalId: string) => {
      setTabs((prev) => {
        const nextTabs = renumberAutoNamedTabs(
          prev.filter((tab) => tab.id !== terminalId),
        );
        setActiveTerminalId((prevActive) => {
          if (prevActive !== terminalId) {
            return prevActive;
          }
          return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null;
        });
        return nextTabs;
      });
      onCloseTerminal?.(terminalId);
    },
    [onCloseTerminal],
  );

  const closeAllTerminals = useCallback(() => {
    setTabs([]);
    setActiveTerminalId(null);
  }, []);

  const setActiveTerminal = useCallback((terminalId: string) => {
    setActiveTerminalId(terminalId);
  }, []);

  const ensureTerminal = useCallback(() => {
    if (activeTerminalId) {
      return activeTerminalId;
    }
    return createTerminal();
  }, [activeTerminalId, createTerminal]);

  const terminals = useMemo(
    () => tabs.map(({ id, title }) => ({ id, title })),
    [tabs],
  );

  return {
    terminals,
    activeTerminalId,
    createTerminal,
    closeTerminal,
    closeAllTerminals,
    setActiveTerminal,
    ensureTerminal,
  };
}
