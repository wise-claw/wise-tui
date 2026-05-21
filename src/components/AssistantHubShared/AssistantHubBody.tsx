import { Empty, Spin } from "antd";
import type { ReactNode } from "react";
import type { AssistantEntry } from "../../types/assistant";
import type { AssistantEngineBindingStatus } from "../AssistantsPanel/engineBinding";
import { AssistantHubCard, type AssistantHubCardMode } from "./AssistantHubCard";
import { buildAssistantHubSections, type AssistantHubFilter } from "./groupAssistants";

export interface AssistantHubBodyProps {
  assistants: AssistantEntry[];
  filter: AssistantHubFilter;
  loading: boolean;
  mode: AssistantHubCardMode;
  emptyDescription?: string;
  resolveEngineStatus?: (assistant: AssistantEntry) => AssistantEngineBindingStatus;
  renderCardActions?: (assistant: AssistantEntry) => {
    disabled?: boolean;
    disabledHint?: string;
    onSelect?: () => void;
    onOpenSettings?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
  };
  header?: ReactNode;
}

export function AssistantHubBody({
  assistants,
  filter,
  loading,
  mode,
  emptyDescription = "此类别暂无助手",
  resolveEngineStatus,
  renderCardActions,
  header,
}: AssistantHubBodyProps) {
  const sections = buildAssistantHubSections(assistants, filter);

  if (loading && assistants.length === 0) {
    return (
      <div className="app-assistants-hub-body">
        {header}
        <div className="app-assistants-hub-loading">
          <Spin size="small" />
        </div>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="app-assistants-hub-body">
        {header}
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="app-assistants-hub-body">
      {header}
      {sections.map((section) => (
        <section key={section.key} className="cockpit-hub__section">
          <h2 className="cockpit-hub__section-title">{section.title}</h2>
          <div className="cockpit-hub__grid">
            {section.assistants.map((assistant) => {
              const actions = renderCardActions?.(assistant) ?? {};
              return (
                <AssistantHubCard
                  key={assistant.id}
                  assistant={assistant}
                  mode={mode}
                  engineStatus={resolveEngineStatus?.(assistant)}
                  disabled={actions.disabled}
                  disabledHint={actions.disabledHint}
                  onSelect={actions.onSelect}
                  onOpenSettings={actions.onOpenSettings}
                  onEdit={actions.onEdit}
                  onDelete={actions.onDelete}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
