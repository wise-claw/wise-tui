import { DeleteOutlined } from "@ant-design/icons";
import { Button, Dropdown, Segmented } from "antd";
import type { MenuProps } from "antd";
import type { SplitResult } from "../../types";

type TaskConfirmFilter = "unconfirmed" | "confirmed";

interface Props {
  filteredTasksCount: number;
  unmetTaskIds: string[];
  unmetMenuItems: MenuProps["items"];
  confirmSavingTaskId: string | null;
  activeResult: SplitResult | null;
  taskConfirmFilter: TaskConfirmFilter;
  taskConfirmCounts: { unconfirmedCount: number; confirmedCount: number };
  primaryActionLabel: string;
  primaryActionLoading: boolean;
  primaryActionDisabled: boolean;
  onPrimaryAction: () => void | Promise<void>;
  onAddTask: () => void;
  onClearAllTasks: () => void;
  onTaskConfirmFilterChange: (filter: TaskConfirmFilter) => void;
}

export function TaskBoardHeader({
  filteredTasksCount,
  unmetTaskIds,
  unmetMenuItems,
  confirmSavingTaskId,
  activeResult,
  taskConfirmFilter,
  taskConfirmCounts,
  primaryActionLabel,
  primaryActionLoading,
  primaryActionDisabled,
  onPrimaryAction,
  onAddTask,
  onClearAllTasks,
  onTaskConfirmFilterChange,
}: Props) {
  const noTasks = !activeResult || activeResult.splitTasks.length === 0;

  return (
    <div className="app-prd-task-panel__task-header-premium">
      {/* Line 1: Title & Main Action Button */}
      <div className="app-prd-task-panel__task-header-title-row">
        <div className="app-prd-task-panel__task-header-title-left">
          <span className="app-prd-task-panel__task-header-title-text">任务草案</span>
          <span className="app-prd-task-panel__task-header-badge">
            {filteredTasksCount}
          </span>
          {unmetTaskIds.length > 0 && (
            <Dropdown
              trigger={["click"]}
              placement="bottomLeft"
              menu={{ items: unmetMenuItems }}
              classNames={{ root: "app-prd-task-panel__unmet-dropdown-root" }}
            >
              <button
                type="button"
                className="app-prd-task-panel__unmet-trigger-pill"
                title="存在问题任务，点击查看锚点"
                aria-label={`存在问题任务 ${unmetTaskIds.length} 个，点击查看锚点`}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="app-prd-task-panel__unmet-dot-anim" />
                <span>异常: {unmetTaskIds.length}</span>
              </button>
            </Dropdown>
          )}
        </div>

        <Button
          size="small"
          type="primary"
          className="app-prd-task-panel__task-primary-action-btn"
          loading={primaryActionLoading}
          disabled={primaryActionDisabled}
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
        </Button>
      </div>

      {/* Line 2: Secondary Toolbar & Filters */}
      <div className="app-prd-task-panel__task-header-toolbar">
        <Segmented
          size="small"
          className="app-prd-task-panel__task-toolbar-segmented-premium"
          value={taskConfirmFilter}
          onChange={(value: string | number) => onTaskConfirmFilterChange(value as TaskConfirmFilter)}
          options={[
            { label: `待确认（${taskConfirmCounts.unconfirmedCount}）`, value: "unconfirmed" },
            { label: `已确认（${taskConfirmCounts.confirmedCount}）`, value: "confirmed" },
          ]}
        />

        <div className="app-prd-task-panel__task-header-buttons">
          <Button
            size="small"
            className="app-prd-task-panel__task-toolbar-action-btn"
            onClick={onAddTask}
            disabled={Boolean(confirmSavingTaskId)}
          >
            新增
          </Button>
          <Button
            size="small"
            danger
            type="default"
            className="app-prd-task-panel__task-toolbar-action-btn is-clear-all"
            icon={<DeleteOutlined />}
            onClick={onClearAllTasks}
            disabled={noTasks}
          >
            清空
          </Button>
        </div>
      </div>
    </div>
  );
}
