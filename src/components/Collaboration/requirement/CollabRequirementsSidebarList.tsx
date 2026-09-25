import { useEffect, useState } from "react";
import { Tag } from "antd";
import {
  listCollabRequirements,
  onCollabChanged,
  requirementProgress,
  requirementStatusLabel,
  sortRequirementSummaries,
} from "../../../services/collaboration";
import { openCollabRequirementDetail } from "../../../stores/collabUiStore";
import type { CollabBusinessStatus, CollabRequirementSummary } from "../../../types/collaboration";
import "../collaboration.css";

interface Props {
  visible: boolean;
  statusFilters: readonly CollabBusinessStatus[];
  executionFilter: "all" | "running" | "attention";
  onCountChange?: (openCount: number) => void;
}

function matches(r: CollabRequirementSummary, statusFilters: readonly CollabBusinessStatus[], executionFilter: Props["executionFilter"]): boolean {
  if (executionFilter === "running") return r.counts.activeAttempts > 0;
  if (executionFilter === "attention") {
    return r.businessStatus !== "done" && (r.counts.openDecisions > 0 || r.businessStatus === "verifying" || r.controlStatus === "paused");
  }
  if (r.controlStatus === "cancelled") return statusFilters.includes("done");
  return statusFilters.includes(r.businessStatus);
}

/** 需求列表中的多仓库协作需求：总进度、需决策 / 待验收提示，点击打开需求详情。 */
export function CollabRequirementsSidebarList({ visible, statusFilters, executionFilter, onCountChange }: Props) {
  const [rows, setRows] = useState<CollabRequirementSummary[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let timer: number | null = null;
    const load = () =>
      void listCollabRequirements(null, true)
        .then((list) => {
          if (!alive) return;
          const sorted = sortRequirementSummaries(list);
          setRows(sorted);
          onCountChange?.(sorted.filter((r) => r.businessStatus !== "done" && r.controlStatus !== "cancelled").length);
        })
        .catch(() => undefined);
    load();
    let unlisten: (() => void) | null = null;
    void onCollabChanged(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(load, 600);
    })
      .then((fn) => {
        if (!alive) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [onCountChange, visible]);

  const shown = rows.filter((r) => matches(r, statusFilters, executionFilter));
  if (!shown.length) return null;

  return (
    <ul className="app-left-sidebar-requirements-panel__list collab-sidebar-list" aria-label="多仓库协作需求">
      {shown.map((r) => {
        const status = requirementStatusLabel(r);
        const progress = requirementProgress(r.counts);
        return (
          <li key={r.id}>
            <div
              className="app-left-sidebar-requirements-panel__row"
              role="button"
              tabIndex={0}
              title={r.title}
              onClick={() => openCollabRequirementDetail(r.id, r.businessStatus === "verifying" ? "acceptance" : undefined)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openCollabRequirementDetail(r.id);
                }
              }}
            >
              <Tag color={status.tone} className="collab-sidebar-list__tag">
                {status.label}
              </Tag>
              {r.counts.openDecisions > 0 ? (
                <Tag color="orange" className="collab-sidebar-list__tag">
                  需决策
                </Tag>
              ) : null}
              <span className="app-left-sidebar-requirements-panel__row-title">
                {r.legacyId ? <span className="collab-sidebar-list__legacy">旧</span> : null}
                {r.title}
              </span>
              <span className="collab-sidebar-list__meta">
                {r.counts.repositories > 1 ? `${r.counts.repositories} 仓 · ` : ""}
                {progress}%
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
