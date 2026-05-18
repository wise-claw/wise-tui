import type {
  EmployeeItem,
  WorkflowGraph,
  WorkflowTemplateItem,
  WorkflowTemplateStage,
} from "../../types";
import type { WorkflowGraphItem, WorkflowGraphValidationResult } from "../../services/workflowGraphs";

export type GraphStatus = "published" | "draft" | "unknown" | "none";

export interface WorkflowConfigModalProps {
  open: boolean;
  inline?: boolean;
  loading: boolean;
  employees: EmployeeItem[];
  templates: WorkflowTemplateItem[];
  projects?: { id: string; name: string }[];
  /** workflowId -> [projectId, ...] map loaded from backend */
  workflowProjectIds?: Record<string, string[]>;
  onClose: () => void;
  onSaveTemplate: (input: {
    workflowId?: string;
    name: string;
    isDefault: boolean;
    stages: WorkflowTemplateStage[];
    projectIds?: string[];
  }) => Promise<WorkflowTemplateItem>;
  onLoadGraphItem: (workflowId: string) => Promise<WorkflowGraphItem | null>;
  onSaveGraph: (input: { workflowId: string; graph: WorkflowGraph; status?: "draft" | "published" }) => Promise<void>;
  onValidateGraph: (graph: WorkflowGraph) => Promise<WorkflowGraphValidationResult>;
  onDeleteTemplate: (workflowId: string) => Promise<void>;
  repositoryPath?: string | null;
  selectableEmployeeIds?: string[];
  initialWorkflowId?: string | null;
}
