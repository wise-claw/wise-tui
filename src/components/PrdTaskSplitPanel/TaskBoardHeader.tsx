import { DeleteOutlined } from "@ant-design/icons";
import { Button, Dropdown, Segmented, Typography } from "antd";
import type { MenuProps } from "antd";
import type { SplitResult } from "../../types";
import { UnmetConditionsQuestionIcon } from "./UnmetConditionsQuestionIcon";
import type { TaskRoleFilter } from "./types";

type TaskConfirmFilter = "unconfirmed" | "confirmed";

interface Props {
  filteredTasksCount: number;
  unmetTaskIds: string[];
  unmetMenuItems: MenuProps["items"];
  confirmSavingTaskId: string | null;
  activeResult: SplitResult | null;
  taskConfirmFilter: TaskConfirmFilter;
  taskConfirmCounts: { unconfirmedCount: number; confirmedCount: number };
  taskRoleFilter: TaskRoleFilter;
  taskRoleFilterOptions: { label: string; value: TaskRoleFilter }[];
  showRoleFilterTabs: boolean;
  onConfirmAll: () => void;
  onAddTask: () => void;
  onClearAllTasks: () => void;
  onTaskConfirmFilterChange: (filter: TaskConfirmFilter) => void;
  onTaskRoleFilterChange: (filter: TaskRoleFilter) => void;
}

export function TaskBoardHeader({
  filteredTasksCount,
  unmetTaskIds,
  unmetMenuItems,
  confirmSavingTaskId,
  activeResult,
  taskConfirmFilter,
  taskConfirmCounts,
  taskRoleFilter,
  taskRoleFilterOptions,
  showRoleFilterTabs,
  onConfirmAll,
  onAddTask,
  onClearAllTasks,
  onTaskConfirmFilterChange,
  onTaskRoleFilterChange,
}: Props) {
  const noTasks = !activeResult || activeResult.splitTasks.length === 0;
  return (
    <div className="app-prd-task-panel__task-title-row">
      <div className="app-prd-task-panel__task-title-row-main">
        <span>
          候选任务
          <Typography.Text type="secondary">（{filteredTasksCount}）</Typography.Text>
        </span>
        {unmetTaskIds.length > 0 ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            menu={{ items: unmetMenuItems }}
            overlayClassName="app-prd-task-panel__unmet-dropdown-root"
          >
            <button
              type="button"
              className="app-prd-task-panel__unmet-trigger"
              title="存在问题任务，点击查看锚点"
              aria-label={`存在问题任务 ${unmetTaskIds.length} 个，点击查看锚点`}
              onClick={(e) => e.stopPropagation()}
            >
              <UnmetConditionsQuestionIcon />
              <span className="app-prd-task-panel__unmet-trigger-count">
                {unmetTaskIds.length}
              </span>
            </button>
          </Dropdown>
        ) : null}
      </div>
      <div className="app-prd-task-panel__task-title-row-tools">
        <Button
          size="small"
          type="primary"
          className="app-prd-task-panel__task-toolbar-btn"
          loading={confirmSavingTaskId === "__all__"}
          disabled={noTasks || Boolean(confirmSavingTaskId)}
          onClick={onConfirmAll}
        >
          一键确认
        </Button>
        <Button
          size="small"
          className="app-prd-task-panel__task-toolbar-btn"
          onClick={onAddTask}
          disabled={Boolean(confirmSavingTaskId)}
        >
          新增
        </Button>
        <Button
          size="small"
          danger
          type="default"
          className="app-prd-task-panel__task-toolbar-btn"
          icon={<DeleteOutlined />}
          onClick={onClearAllTasks}
          disabled={noTasks}
        >
          全部清空
        </Button>
        <Segmented
          size="small"
          className="app-prd-task-panel__task-toolbar-segmented"
          value={taskConfirmFilter}
          onChange={(value: string | number) => onTaskConfirmFilterChange(value as TaskConfirmFilter)}
          options={[
            { label: `未确认（${taskConfirmCounts.unconfirmedCount}）`, value: "unconfirmed" },
            { label: `已确认（${taskConfirmCounts.confirmedCount}）`, value: "confirmed" },
          ]}
        />
        {showRoleFilterTabs ? (
          <Segmented
            size="small"
            className="app-prd-task-panel__task-toolbar-segmented"
            value={taskRoleFilter}
            onChange={(value: string | number) => onTaskRoleFilterChange(value as TaskRoleFilter)}
            options={taskRoleFilterOptions}
          />
        ) : null}
      </div>
    </div>
  );
}
