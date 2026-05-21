import { Card, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import { lazy } from "react";
import type { ClipboardEvent, RefObject } from "react";
import type { MilkdownEditorHandle, MilkdownTaskAnchor } from "../MilkdownViewer";
import type { AssistantBundleItem } from "../../services/assistantPromptLayers";
import type { AssistantWorkflowRef } from "../../types/assistant";
import type { LegacyRunSummary } from "../../services/prdSplit/legacyRunsImport";
import { RequirementBoardActions } from "./RequirementBoardActions";
import { RequirementBoardHeader } from "./RequirementBoardHeader";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

interface RequirementOption {
  id: string;
  requirementDisplayName: string;
  isPinned?: boolean;
}

interface ActiveRequirementSummary {
  isPinned?: boolean;
}

interface Props {
  activeRequirementId: string | null;
  activeRequirement: ActiveRequirementSummary | null;
  options: RequirementOption[];
  inputValue: string;
  inputError: string | null;
  showUrlAnchorHint: boolean;
  hasInput: boolean;
  parsing: boolean;
  splitStarting: boolean;
  promptActionItems: MenuProps["items"];
  assistantRuntimeLoading: boolean;
  assistantWorkflowOptions: AssistantWorkflowRef[];
  assistantMcpOptions: AssistantBundleItem[];
  assistantSelectedMcpIds: string[];
  assistantHistoryOptions: LegacyRunSummary[];
  assistantHistoryLoading: boolean;
  editorRef: RefObject<MilkdownEditorHandle | null>;
  editorShellRef: RefObject<HTMLDivElement | null>;
  taskAnchors: MilkdownTaskAnchor[] | undefined;
  selectedAnchorTaskId: string | null;
  filteredTaskCount: number;
  onInputChange: (value: string) => void;
  onPasteImage: (event: ClipboardEvent<HTMLDivElement>) => void;
  onSplitSelection: () => void;
  onResolvedTaskAnchorIdsChange: (taskIds: string[]) => void;
  onTaskAnchorRangesChange: (ranges: Record<string, { from: number; to: number }>) => void;
  onTaskAnchorMarkerClick: (taskId: string) => void;
  onSaveDraft: () => void;
  onStartSplit: () => void;
  onImportPrdFile: () => void;
  onImportLegacyPrd: (summary: LegacyRunSummary) => void;
  onAssistantMcpsChange: (ids: string[]) => void;
  onPickRequirement: (value: string) => void;
  onPinRequirement: () => void;
  onCreateRequirement: () => void;
  onDeleteRequirement: () => void;
}

export function RequirementInputCard({
  activeRequirementId,
  activeRequirement,
  options,
  inputValue,
  inputError,
  showUrlAnchorHint,
  hasInput,
  parsing,
  splitStarting,
  promptActionItems,
  assistantRuntimeLoading,
  assistantWorkflowOptions,
  assistantMcpOptions,
  assistantSelectedMcpIds,
  assistantHistoryOptions,
  assistantHistoryLoading,
  editorRef,
  editorShellRef,
  taskAnchors,
  selectedAnchorTaskId,
  filteredTaskCount,
  onInputChange,
  onPasteImage,
  onSplitSelection,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onTaskAnchorMarkerClick,
  onSaveDraft,
  onStartSplit,
  onImportPrdFile,
  onImportLegacyPrd,
  onAssistantMcpsChange,
  onPickRequirement,
  onPinRequirement,
  onCreateRequirement,
  onDeleteRequirement,
}: Props) {
  return (
    <Card
      size="small"
      title={(
        <RequirementBoardHeader
          activeRequirementId={activeRequirementId}
          activeRequirement={activeRequirement}
          options={options}
          onPick={onPickRequirement}
          onPin={onPinRequirement}
          onCreate={onCreateRequirement}
          onDelete={onDeleteRequirement}
        />
      )}
      className="app-prd-task-panel__left-card"
      bodyStyle={{ padding: "0 0 16px 0" }}
    >
      <Space
        orientation="vertical"
        size={10}
        className="app-prd-task-panel__full-width app-prd-task-panel__requirement-content"
      >
        <div
          ref={editorShellRef}
          className="app-prd-task-panel__editor-shell"
          onPasteCapture={(e) => onPasteImage(e)}
        >
          <LazyMilkdownEditor
            editorRef={editorRef}
            text={inputValue}
            onChange={onInputChange}
            onSplitSelection={onSplitSelection}
            taskAnchors={taskAnchors}
            selectedAnchorTaskId={selectedAnchorTaskId}
            filteredTaskCount={filteredTaskCount}
            onResolvedTaskAnchorIdsChange={onResolvedTaskAnchorIdsChange}
            onTaskAnchorRangesChange={onTaskAnchorRangesChange}
            onTaskAnchorMarkerClick={onTaskAnchorMarkerClick}
          />
        </div>
        {inputError ? <Typography.Text type="danger">{inputError}</Typography.Text> : null}
        {showUrlAnchorHint ? (
          <Typography.Text type="warning">
            当前输入为 URL，若左侧仅显示链接文本则无法定位需求锚点；请先执行一次拆分以回填正文后再查看锚点。
          </Typography.Text>
        ) : null}
        <RequirementBoardActions
          hasInput={hasInput}
          parsing={parsing}
          splitStarting={splitStarting}
          promptActionItems={promptActionItems}
          assistantRuntimeLoading={assistantRuntimeLoading}
          assistantWorkflowOptions={assistantWorkflowOptions}
          assistantMcpOptions={assistantMcpOptions}
          assistantSelectedMcpIds={assistantSelectedMcpIds}
          assistantHistoryOptions={assistantHistoryOptions}
          assistantHistoryLoading={assistantHistoryLoading}
          onSaveDraft={onSaveDraft}
          onStartSplit={onStartSplit}
          onImportPrdFile={onImportPrdFile}
          onImportLegacyPrd={onImportLegacyPrd}
          onAssistantMcpsChange={onAssistantMcpsChange}
        />
      </Space>
    </Card>
  );
}

interface LazyMilkdownEditorProps {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  text: string;
  onChange: (value: string) => void;
  onSplitSelection: () => void;
  taskAnchors: MilkdownTaskAnchor[] | undefined;
  selectedAnchorTaskId: string | null;
  filteredTaskCount: number;
  onResolvedTaskAnchorIdsChange: (taskIds: string[]) => void;
  onTaskAnchorRangesChange: (ranges: Record<string, { from: number; to: number }>) => void;
  onTaskAnchorMarkerClick: (taskId: string) => void;
}

function LazyMilkdownEditor({
  editorRef,
  text,
  onChange,
  onSplitSelection,
  taskAnchors,
  selectedAnchorTaskId,
  filteredTaskCount,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onTaskAnchorMarkerClick,
}: LazyMilkdownEditorProps) {
  return (
    <MilkdownEditor
      ref={editorRef}
      text={text}
      onChange={onChange}
      onToolbarSplitSelection={onSplitSelection}
      taskAnchors={taskAnchors}
      selectedRequirementAnchorKey={selectedAnchorTaskId}
      onResolvedTaskAnchorIdsChange={(taskIds) => {
        if (filteredTaskCount === 0) return;
        onResolvedTaskAnchorIdsChange(taskIds);
      }}
      onTaskAnchorRangesChange={(ranges) => {
        if (filteredTaskCount === 0) return;
        onTaskAnchorRangesChange(ranges);
      }}
      onTaskAnchorMarkerClick={onTaskAnchorMarkerClick}
    />
  );
}
