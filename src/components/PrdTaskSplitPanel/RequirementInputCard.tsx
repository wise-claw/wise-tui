import { Card, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import { lazy } from "react";
import type { ClipboardEvent, RefObject } from "react";
import type { MilkdownEditorHandle, MilkdownTaskAnchor } from "../MilkdownViewer";
import { RequirementBoardActions } from "./RequirementBoardActions";
import { RequirementBoardHeader } from "./RequirementBoardHeader";
import { InlineRuntimePanel } from "./InlineRuntimePanel";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

interface RequirementOption {
  id: string;
  requirementDisplayName: string;
  isPinned?: boolean;
}

interface ActiveRequirementSummary {
  requirementDisplayName: string;
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
  editorRef: RefObject<MilkdownEditorHandle | null>;
  editorShellRef: RefObject<HTMLDivElement | null>;
  taskAnchors: MilkdownTaskAnchor[] | undefined;
  selectedAnchorTaskId: string | null;
  filteredTaskCount: number;
  splitRuntimeVisible: boolean;
  splitRuntimeRef: RefObject<HTMLDivElement | null>;
  splitRuntimeListRef: RefObject<HTMLDivElement | null>;
  splitRuntimeLogs: SplitRuntimeLogItem[];
  retryingPhase: SplitRetryPhase | null;
  onInputChange: (value: string) => void;
  onPickRequirement: (value: string) => void;
  onPinRequirement: () => void;
  onCreateRequirement: () => void;
  onDeleteRequirement: () => void;
  onPasteImage: (event: ClipboardEvent<HTMLDivElement>) => void;
  onSplitSelection: () => void;
  onResolvedTaskAnchorIdsChange: (taskIds: string[]) => void;
  onTaskAnchorRangesChange: (ranges: Record<string, { from: number; to: number }>) => void;
  onTaskAnchorMarkerClick: (taskId: string) => void;
  onCloseRuntimePanel: () => void;
  onRetryStage: (phase: SplitRetryPhase) => void;
  onSaveDraft: () => void;
  onStartSplit: () => void;
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
  editorRef,
  editorShellRef,
  taskAnchors,
  selectedAnchorTaskId,
  filteredTaskCount,
  splitRuntimeVisible,
  splitRuntimeRef,
  splitRuntimeListRef,
  splitRuntimeLogs,
  retryingPhase,
  onInputChange,
  onPickRequirement,
  onPinRequirement,
  onCreateRequirement,
  onDeleteRequirement,
  onPasteImage,
  onSplitSelection,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onTaskAnchorMarkerClick,
  onCloseRuntimePanel,
  onRetryStage,
  onSaveDraft,
  onStartSplit,
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
          <InlineRuntimePanel
            visible={splitRuntimeVisible}
            parsing={parsing}
            containerRef={splitRuntimeRef}
            listRef={splitRuntimeListRef}
            logs={splitRuntimeLogs}
            retryingPhase={retryingPhase}
            onClose={onCloseRuntimePanel}
            onRetryStage={onRetryStage}
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
          onSaveDraft={onSaveDraft}
          onStartSplit={onStartSplit}
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
