import { Suspense, lazy, useState } from "react";
import {
  useWorkspaceRequirementCreateModalOpen,
  useWorkspaceRequirementEditModalOpen,
} from "../../stores/workspaceMemoPanelStore";
import type { WorkspaceRequirementModalProps } from "./WorkspaceRequirementModal";

const LazyWorkspaceRequirementModal = lazy(() =>
  import("./WorkspaceRequirementModal").then((module) => ({
    default: module.WorkspaceRequirementModal,
  })),
);

/** Loads the requirement editor on first open and keeps it mounted afterwards so the close animation still plays. */
export function DeferredWorkspaceRequirementModal(props: WorkspaceRequirementModalProps) {
  const createOpen = useWorkspaceRequirementCreateModalOpen();
  const editOpen = useWorkspaceRequirementEditModalOpen();
  const [requested, setRequested] = useState(false);
  if (!requested && (createOpen || editOpen)) {
    setRequested(true);
  }
  if (!requested && !createOpen && !editOpen) return null;
  return (
    <Suspense fallback={null}>
      <LazyWorkspaceRequirementModal {...props} />
    </Suspense>
  );
}
