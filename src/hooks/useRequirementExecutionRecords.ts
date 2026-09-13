import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { listRequirementExecutionRecords, REQUIREMENT_EXECUTION_RECORDS_CHANGED } from "../services/requirementExecutionRecords";
import type { RequirementExecutionRecord } from "../types/requirementExecutionRecord";

export function useRequirementExecutionRecords(requirementId: string) {
  const [state, setState] = useState<{ requirementId: string; records: RequirementExecutionRecord[]; loading: boolean; error: string | null }>({ requirementId, records: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let sequence = 0;
    const refresh = async () => {
      const current = ++sequence;
      try {
        const records = await listRequirementExecutionRecords(requirementId);
        if (!disposed && current === sequence) setState({ requirementId, records, loading: false, error: null });
      } catch (error) {
        if (!disposed && current === sequence) setState({ requirementId, records: [], loading: false, error: String(error) });
      }
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === requirementId) void refresh();
    };
    window.addEventListener(REQUIREMENT_EXECUTION_RECORDS_CHANGED, onChange);
    const unlisten = listen<string>("wise-requirement-execution-records-changed", (event) => {
      if (event.payload === requirementId) void refresh();
    }).catch(() => () => {});
    void refresh();
    return () => {
      disposed = true;
      window.removeEventListener(REQUIREMENT_EXECUTION_RECORDS_CHANGED, onChange);
      void unlisten.then((stop) => stop());
    };
  }, [requirementId, revision]);
  return {
    ...(state.requirementId === requirementId ? state : { records: [], loading: true, error: null }),
    retry: () => setRevision((value) => value + 1),
  };
}
