import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalSessionSource } from "../types/terminal";

export type TerminalTab = {
  id: string;
  title: string;
  source: TerminalSessionSource;
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
  const ensureInFlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTerminalId) {
      ensureInFlightIdRef.current = null;
    }
  }, [activeTerminalId]);

  const createTerminal = useCallback((source: TerminalSessionSource = "user") => {
    const id = createTerminalId();
    setTabs((prev) => {
      const nextTabs = renumberAutoNamedTabs([
        ...prev,
        { id, title: "", autoNamed: true, source },
      ]);
      return nextTabs;
    });
    setActiveTerminalId(id);
    return id;
  }, []);

  const registerTerminal = useCallback(
    (input: { id: string; title?: string; source?: TerminalSessionSource }) => {
      setTabs((prev) => {
        if (prev.some((tab) => tab.id === input.id)) {
          return prev;
        }
        const source = input.source ?? "user";
        const title =
          input.title?.trim() ||
          (source === "agent" ? "Agent 终端" : "");
        return renumberAutoNamedTabs([
          ...prev,
          {
            id: input.id,
            title,
            source,
            autoNamed: !input.title?.trim(),
          },
        ]);
      });
    },
    [],
  );

  const getTerminalSource = useCallback(
    (terminalId: string): TerminalSessionSource => {
      return tabs.find((tab) => tab.id === terminalId)?.source ?? "user";
    },
    [tabs],
  );

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
    if (ensureInFlightIdRef.current) {
      return ensureInFlightIdRef.current;
    }

    const id = createTerminalId();
    ensureInFlightIdRef.current = id;

    setTabs((prev) => {
      if (prev.length > 0) {
        const existingId = prev[prev.length - 1]!.id;
        ensureInFlightIdRef.current = existingId;
        return prev;
      }
      return renumberAutoNamedTabs([
        ...prev,
        { id, title: "", autoNamed: true, source: "user" },
      ]);
    });

    setActiveTerminalId((prev) => prev ?? ensureInFlightIdRef.current);

    return ensureInFlightIdRef.current;
  }, [activeTerminalId]);

  const terminals = useMemo(
    () => tabs.map(({ id, title, source }) => ({ id, title, source })),
    [tabs],
  );

  return {
    terminals,
    activeTerminalId,
    createTerminal,
    registerTerminal,
    getTerminalSource,
    closeTerminal,
    closeAllTerminals,
    setActiveTerminal,
    ensureTerminal,
  };
}
