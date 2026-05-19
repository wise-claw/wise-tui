import { DeleteOutlined } from "@ant-design/icons";
import { Button, Popover, Tooltip } from "antd";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import type { TaskApiSpec, TaskExecutionStatus, TaskItem } from "../../types";
import {
  taskRoleChineseLabel,
  taskRoleTagModifierClass,
} from "../../utils/repositoryType";
import { anchorLabelFromTaskId } from "./helpers";
import { TaskApiSpecEditor } from "./TaskApiSpecEditor";

const MilkdownEditor = lazy(() =>
  import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })),
);

interface Props {
  task: TaskItem;
  draftedTask: TaskItem;
  selected: boolean;
  canDelete: boolean;
  pendingContent: string | undefined;
  draftedTaskMarkdown: string;
  pendingApiSpec: TaskApiSpec | undefined;
  showApiSpec: boolean;
  executionStatus: TaskExecutionStatus;
  generatingTaskId: string | null;
  savingTaskId: string | null;
  confirmSavingTaskId: string | null;
  closingMotionActive: boolean;
  taskUnmetLines: string[];
  taskExecutableCheckResult: string;
  unmetCollapsed: boolean;
  checkCollapsed: boolean;
  anchorPopoverOpen: boolean;
  aiPopoverMode: "optimize" | "check" | null;
  taskAiPopoverContent: ReactNode;
  taskAnchorPopoverContent: ReactNode;
  onSelect: () => void;
  onLocateAnchor: () => void;
  onDelete: () => void;
  onPendingContentChange: (markdown: string) => void;
  onPendingApiSpecChange: (spec: TaskApiSpec) => void;
  onAnchorPopoverChange: (open: boolean) => void;
  onAiPopoverChange: (mode: "optimize" | "check", open: boolean) => void;
  onGenerateExecutable: () => void;
  onSaveDraft: () => void;
  onConfirmAdjustment: () => void;
  onToggleUnmet: () => void;
  onToggleCheck: () => void;
}

export function TaskCard({
  task,
  draftedTask,
  selected,
  canDelete,
  pendingContent,
  draftedTaskMarkdown,
  pendingApiSpec,
  showApiSpec,
  executionStatus,
  generatingTaskId,
  savingTaskId,
  confirmSavingTaskId,
  closingMotionActive,
  taskUnmetLines,
  taskExecutableCheckResult,
  unmetCollapsed,
  checkCollapsed,
  anchorPopoverOpen,
  aiPopoverMode,
  taskAiPopoverContent,
  taskAnchorPopoverContent,
  onSelect,
  onLocateAnchor,
  onDelete,
  onPendingContentChange,
  onPendingApiSpecChange,
  onAnchorPopoverChange,
  onAiPopoverChange,
  onGenerateExecutable,
  onSaveDraft,
  onConfirmAdjustment,
  onToggleUnmet,
  onToggleCheck,
}: Props) {
  const isExecutable = executionStatus === "executable";
  const isGenerating = generatingTaskId === task.id;
  const isOtherGenerating = generatingTaskId !== null && generatingTaskId !== task.id;
  const isSaving = savingTaskId === task.id;
  const isConfirmSaving = confirmSavingTaskId === task.id;
  const hasUnmet = taskUnmetLines.length > 0;
  const hasCheckResult = taskExecutableCheckResult.trim().length > 0;

  return (
    <div
      key={task.id}
      data-task-id={task.id}
      className={`app-prd-task-panel__task-list-item ${selected ? "is-active" : ""}`}
      tabIndex={0}
      onClick={onSelect}
    >
      <div className="app-prd-task-panel__task-card-head">
        <div className="app-prd-task-panel__task-card-meta-row">
          <Button
            type="text"
            size="small"
            className="app-prd-task-panel__task-link-btn"
            title={`定位需求锚点 #${anchorLabelFromTaskId(task.id)}`}
            onClick={(e) => {
              e.stopPropagation();
              onLocateAnchor();
            }}
          >
            定位需求 #{anchorLabelFromTaskId(task.id)}
          </Button>
          <div className="app-prd-task-panel__task-card-tags">
            <span className={`app-prd-task-panel__task-role-tag ${taskRoleTagModifierClass(task.role)}`}>
              {taskRoleChineseLabel(task.role)}
            </span>
          </div>
          <Button
            type="text"
            danger
            size="small"
            className="app-prd-task-panel__task-delete-btn"
            icon={<DeleteOutlined />}
            title="删除该任务项"
            aria-label={`删除任务 ${task.id}`}
            disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      </div>
      <div
        className="app-prd-task-panel__task-card-editor is-editing"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Suspense fallback={null}>
          <MilkdownEditor
            floatingToolbar={false}
            text={pendingContent ?? draftedTaskMarkdown}
            onChange={onPendingContentChange}
          />
        </Suspense>
      </div>
      {showApiSpec ? (
        <TaskApiSpecEditor
          value={pendingApiSpec ?? draftedTask.apiSpec}
          draftedTask={draftedTask}
          onChange={onPendingApiSpecChange}
        />
      ) : null}
      <div
        className="app-prd-task-panel__task-card-footer"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-prd-task-panel__task-execution-row">
          <Popover
            trigger="click"
            placement="topLeft"
            open={anchorPopoverOpen}
            onOpenChange={onAnchorPopoverChange}
            overlayClassName="app-prd-task-panel__task-anchor-popover"
            content={taskAnchorPopoverContent}
          >
            <Button
              type="default"
              size="small"
              className="app-prd-task-panel__task-anchor-btn"
              onClick={(e) => e.stopPropagation()}
            >
              taskAnchors
            </Button>
          </Popover>
          <div className="app-prd-task-panel__task-execution-actions">
            <Tooltip
              title={
                isExecutable
                  ? "将当前拆分任务写入 Workspace Trellis"
                  : "请先点击「任务合理，确认」或消除缺口后再落盘"
              }
            >
              <span className="app-prd-task-panel__task-generate-exec-footer-wrap">
                <Button
                  type="default"
                  size="small"
                  className="app-prd-task-panel__task-save-btn"
                  loading={isGenerating}
                  disabled={
                    !isExecutable
                    || Boolean(confirmSavingTaskId)
                    || closingMotionActive
                    || isOtherGenerating
                  }
                  onClick={onGenerateExecutable}
                >
                  落盘到 Trellis
                </Button>
              </span>
            </Tooltip>
            <Popover
              trigger="click"
              placement="leftTop"
              open={aiPopoverMode === "optimize"}
              onOpenChange={(open) => onAiPopoverChange("optimize", open)}
              overlayClassName="app-prd-task-panel__task-ai-popover"
              content={taskAiPopoverContent}
            >
              <Button
                type="default"
                size="small"
                className="app-prd-task-panel__task-save-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAiPopoverChange("optimize", true);
                }}
              >
                内容优化
              </Button>
            </Popover>
            <Popover
              trigger="click"
              placement="leftTop"
              open={aiPopoverMode === "check"}
              onOpenChange={(open) => onAiPopoverChange("check", open)}
              overlayClassName="app-prd-task-panel__task-ai-popover"
              content={taskAiPopoverContent}
            >
              <Button
                type="default"
                size="small"
                className="app-prd-task-panel__task-save-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAiPopoverChange("check", true);
                }}
              >
                可执行检测
              </Button>
            </Popover>
            <Button
              type="default"
              size="small"
              className="app-prd-task-panel__task-save-btn"
              loading={isSaving}
              onClick={onSaveDraft}
            >
              保存
            </Button>
            {!isExecutable ? (
              <Button
                type="primary"
                size="small"
                className="app-prd-task-panel__task-confirm-btn"
                loading={isConfirmSaving}
                disabled={
                  Boolean(savingTaskId)
                  || (Boolean(confirmSavingTaskId) && confirmSavingTaskId !== task.id)
                }
                onClick={onConfirmAdjustment}
              >
                任务合理，确认
              </Button>
            ) : null}
          </div>
        </div>
        {hasUnmet || hasCheckResult ? (
          <div className="app-prd-task-panel__task-unmet-box">
            {hasUnmet && !unmetCollapsed ? (
              <>
                <div className="app-prd-task-panel__task-unmet-title-row">
                  <div className="app-prd-task-panel__task-unmet-title">
                    待沟通或补充的缺口（请合并进任务描述 / 子任务 / 验收标准 / 接口协议等）
                  </div>
                  <Button
                    size="small"
                    type="text"
                    className="app-prd-task-panel__task-unmet-toggle-btn"
                    onClick={onToggleUnmet}
                  >
                    收起缺口
                  </Button>
                </div>
                <ul className="app-prd-task-panel__task-unmet-list">
                  {taskUnmetLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {hasUnmet && unmetCollapsed ? (
              <div className="app-prd-task-panel__task-unmet-title-row">
                <div className="app-prd-task-panel__task-unmet-title">
                  待沟通或补充的缺口（已收起）
                </div>
                <Button
                  size="small"
                  type="text"
                  className="app-prd-task-panel__task-unmet-toggle-btn"
                  onClick={onToggleUnmet}
                >
                  展开缺口
                </Button>
              </div>
            ) : null}
            {hasCheckResult && !checkCollapsed ? (
              <div className="app-prd-task-panel__task-unmet-check-result">
                <div className="app-prd-task-panel__task-unmet-title-row">
                  <div className="app-prd-task-panel__task-unmet-title">可执行检测结果</div>
                  <Button
                    size="small"
                    type="text"
                    className="app-prd-task-panel__task-unmet-toggle-btn"
                    onClick={onToggleCheck}
                  >
                    收起检测
                  </Button>
                </div>
                <pre className="app-prd-task-panel__task-unmet-check-result-text">
                  {taskExecutableCheckResult}
                </pre>
              </div>
            ) : null}
            {hasCheckResult && checkCollapsed ? (
              <div className="app-prd-task-panel__task-unmet-check-result">
                <div className="app-prd-task-panel__task-unmet-title-row">
                  <div className="app-prd-task-panel__task-unmet-title">可执行检测结果（已收起）</div>
                  <Button
                    size="small"
                    type="text"
                    className="app-prd-task-panel__task-unmet-toggle-btn"
                    onClick={onToggleCheck}
                  >
                    展开检测
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
