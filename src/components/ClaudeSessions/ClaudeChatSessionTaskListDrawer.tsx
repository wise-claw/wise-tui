import { Button, Drawer, message, Popover, Popconfirm, Empty } from "antd";
import { memo, useCallback, type Dispatch, type SetStateAction } from "react";
import { openRequirementSourceFromTaskDrawer, TaskListDrawerEmptyState } from "./TaskListDrawerEmptyState";
import type { ProjectItem, TaskFlowStatus, TaskItem } from "../../types";
import type { TrellisRequirementTaskRow } from "../../services/trellisTaskBridge";
import type { OmcBatchTemplateId } from "../../constants/omcBatchTemplates";
import {
  formatTaskRoleLabel,
  splitTaskListBinaryLabel,
} from "./claudeChatHelpers";
import {
  getTrellisTaskRelativePath,
  trellisTaskRowKey,
} from "./ClaudeChatSessionFeatureShared";

export interface ClaudeChatSessionTaskListDrawerProps {
  open: boolean;
  onClose: () => void;
  traceDrawerWidth: number;
  taskDrawerCount: number;
  taskDrawerCounts: { wiseTodo: number; trellisRunnable: number; total: number };
  trellisTaskFocus: { parentTaskName: string | null; childTaskNames: string[] } | null;
  setTrellisTaskFocus: Dispatch<SetStateAction<{ parentTaskName: string | null; childTaskNames: string[] } | null>>;
  splitTodoTasks: TaskItem[];
  visibleTrellisTasks: TrellisRequirementTaskRow[];
  trellisTasksLoading: boolean;
  taskListStatusFilter: "all" | "todo" | "done";
  setTaskListStatusFilter: Dispatch<SetStateAction<"all" | "todo" | "done">>;
  taskListSelectableSliceIds: string[];
  taskListAllFilteredSelected: boolean;
  taskListMultiSelectCap: number;
  filteredTaskList: TaskItem[];
  taskListSelectedIds: string[];
  setTaskListSelectedIds: Dispatch<SetStateAction<string[]>>;
  taskListSelectedSet: Set<string>;
  omcBatchPopoverOpen: boolean;
  setOmcBatchPopoverOpen: Dispatch<SetStateAction<boolean>>;
  omcBatchTemplateId: OmcBatchTemplateId;
  setOmcBatchTemplateId: Dispatch<SetStateAction<OmcBatchTemplateId>>;
  handleOmcBatchConfirmFromPopover: () => void;
  handleDeleteAllSplitTasks: () => void;
  handleAdjustTaskStatus: (task: TaskItem, status: TaskFlowStatus) => void | Promise<void>;
  handleCompleteTaskManually: (task: TaskItem) => void | Promise<void>;
  handleConfirmDeleteSplitTask: (task: TaskItem) => void | Promise<void>;
  handleRunTaskInMainSession: (task: TaskItem) => void | Promise<void>;
  persistSplitTaskDispatchField: (
    taskId: string,
    field: "splitListEmployeeName" | "splitListWorkflowId",
    value: string,
  ) => void | Promise<void>;
  handleRunTaskByEmployee: (task: TaskItem) => void | Promise<void>;
  handleRunTaskByTeam: (task: TaskItem) => void | Promise<void>;
  taskListEmployeeOptions: ReadonlyArray<{ id: string; name: string }>;
  taskListTeamOptions: ReadonlyArray<{ id: string; name: string }>;
  activeProject?: ProjectItem | null;
  syncTrellisTaskList: () => void | Promise<void>;
  trellisTaskSelectableKeys: string[];
  trellisTaskAllSelected: boolean;
  trellisTaskSelectedKeys: string[];
  trellisTaskSelectedSet: Set<string>;
  setTrellisTaskSelectedKeys: Dispatch<SetStateAction<string[]>>;
  trellisBatchEmployeeName: string;
  setTrellisBatchEmployeeName: Dispatch<SetStateAction<string>>;
  trellisEmployeeDispatchAvailable: boolean;
  trellisTaskEmployeeByKey: Record<string, string>;
  setTrellisTaskEmployeeByKey: Dispatch<SetStateAction<Record<string, string>>>;
  handleBatchRunTrellisByEmployee: () => void;
  handleBatchArchiveTrellisTasks: () => void;
  handleRunTrellisTaskInMainSession: (task: TrellisRequirementTaskRow) => void | Promise<void>;
  handleArchiveTrellisTask: (task: TrellisRequirementTaskRow) => void | Promise<void>;
  handleRunTrellisTaskByEmployee: (task: TrellisRequirementTaskRow) => void | Promise<void>;
}

export const ClaudeChatSessionTaskListDrawer = memo(function ClaudeChatSessionTaskListDrawer(
  props: ClaudeChatSessionTaskListDrawerProps,
) {
  const {
    open,
    onClose,
    traceDrawerWidth,
    taskDrawerCount,
    taskDrawerCounts,
    trellisTaskFocus,
    setTrellisTaskFocus,
    splitTodoTasks,
    visibleTrellisTasks,
    trellisTasksLoading,
    taskListStatusFilter,
    setTaskListStatusFilter,
    taskListSelectableSliceIds,
    taskListAllFilteredSelected,
    taskListMultiSelectCap,
    filteredTaskList,
    taskListSelectedIds,
    setTaskListSelectedIds,
    taskListSelectedSet,
    omcBatchPopoverOpen,
    setOmcBatchPopoverOpen,
    omcBatchTemplateId,
    setOmcBatchTemplateId,
    handleOmcBatchConfirmFromPopover,
    handleDeleteAllSplitTasks,
    handleAdjustTaskStatus,
    handleCompleteTaskManually,
    handleConfirmDeleteSplitTask,
    handleRunTaskInMainSession,
    persistSplitTaskDispatchField,
    handleRunTaskByEmployee,
    handleRunTaskByTeam,
    taskListEmployeeOptions,
    taskListTeamOptions,
    activeProject,
    syncTrellisTaskList,
    trellisTaskSelectableKeys,
    trellisTaskAllSelected,
    trellisTaskSelectedKeys,
    trellisTaskSelectedSet,
    setTrellisTaskSelectedKeys,
    trellisBatchEmployeeName,
    setTrellisBatchEmployeeName,
    trellisEmployeeDispatchAvailable,
    trellisTaskEmployeeByKey,
    setTrellisTaskEmployeeByKey,
    handleBatchRunTrellisByEmployee,
    handleBatchArchiveTrellisTasks,
    handleRunTrellisTaskInMainSession,
    handleArchiveTrellisTask,
    handleRunTrellisTaskByEmployee,
  } = props;

  const handleOpenRequirementSource = useCallback(() => {
    openRequirementSourceFromTaskDrawer(onClose);
  }, [onClose]);

  const activeProjectName = activeProject?.name?.trim() || null;

  return (
    <Drawer
      title={
        taskDrawerCount > 0
          ? `任务（Wise ${taskDrawerCounts.wiseTodo} · Trellis ${taskDrawerCounts.trellisRunnable}）`
          : "任务"
      }
      placement="right"
      size={traceDrawerWidth}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{ body: "app-claude-task-list-drawer-body" }}
      styles={{
        body: {
          padding: 12,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      <div className="app-claude-task-list-drawer-inner">
        {trellisTaskFocus ? (
          <div className="app-claude-task-list__focus-bar">
            <span>
              当前聚焦：{trellisTaskFocus.parentTaskName || "本次落盘任务"}
              {trellisTaskFocus.childTaskNames.length > 0 ? ` · ${trellisTaskFocus.childTaskNames.length} 个子任务` : ""}
            </span>
            <button type="button" onClick={() => setTrellisTaskFocus(null)}>
              显示全部
            </button>
          </div>
        ) : null}
        {splitTodoTasks.length === 0 && visibleTrellisTasks.length === 0 ? (
          <TaskListDrawerEmptyState
            loading={trellisTasksLoading}
            activeProjectName={activeProjectName}
            onOpenRequirementSource={handleOpenRequirementSource}
          />
        ) : (
          <div className="app-claude-task-list">
            {splitTodoTasks.length > 0 ? (
              <>
                <div className="app-claude-task-list__batch-bar">
                  <label className="app-claude-task-list__batch-check">
                    <span>筛选</span>
                    <select
                      className="app-claude-task-list__batch-filter"
                      value={taskListStatusFilter}
                      onChange={(e) => {
                        setTaskListStatusFilter(e.currentTarget.value as "all" | "todo" | "done");
                      }}
                    >
                      <option value="all">全部</option>
                      <option value="todo">未完成</option>
                      <option value="done">已完成</option>
                    </select>
                  </label>
                  <label className="app-claude-task-list__batch-check">
                    <input
                      type="checkbox"
                      disabled={taskListSelectableSliceIds.length === 0}
                      checked={taskListAllFilteredSelected}
                      onChange={(e) => {
                        if (e.currentTarget.checked) {
                          const next = taskListSelectableSliceIds.slice();
                          setTaskListSelectedIds(next);
                          if (filteredTaskList.length > taskListMultiSelectCap) {
                            void message.info(`当前视图共 ${filteredTaskList.length} 条，已自动只选前 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                          }
                          return;
                        }
                        setTaskListSelectedIds([]);
                      }}
                    />
                    <span>全选当前视图</span>
                  </label>
                  <span className="app-claude-task-list__batch-count">
                    已选 {taskListSelectedIds.length} / {taskListMultiSelectCap}
                  </span>
                  <div className="app-claude-task-list__batch-actions">
                    <Popover
                      trigger="click"
                      open={omcBatchPopoverOpen}
                      onOpenChange={setOmcBatchPopoverOpen}
                      placement="bottomLeft"
                      classNames={{ root: "app-claude-task-list__omc-popover-root" }}
                      content={(
                        <div className="app-claude-task-list__omc-popover">
                          <div className="app-claude-task-list__omc-field">
                            <label htmlFor="omc-batch-template">执行模板</label>
                            <select
                              id="omc-batch-template"
                              className="app-claude-task-list__omc-select"
                              value={omcBatchTemplateId}
                              onChange={(e) => {
                                setOmcBatchTemplateId(e.currentTarget.value as OmcBatchTemplateId);
                              }}
                            >
                              <option value="autopilot">autopilot（/autopilot）</option>
                              <option value="ultraqa">ultraqa（/ultraqa）</option>
                              <option value="verify">verify（/verify）</option>
                              <option value="team">team（/team）</option>
                              <option value="trellis">trellis（Trellis adapter）</option>
                            </select>
                          </div>
                          <div className="app-claude-task-list__omc-footer">
                            <Button size="small" onClick={() => setOmcBatchPopoverOpen(false)}>
                              关闭
                            </Button>
                            <Button type="primary" size="small" onClick={handleOmcBatchConfirmFromPopover}>
                              执行
                            </Button>
                          </div>
                        </div>
                      )}
                    >
                      <button type="button" className="app-claude-task-list__batch-action-btn">
                        批量OMC执行
                      </button>
                    </Popover>
                    <button
                      type="button"
                      className="app-claude-task-list__batch-action-btn app-claude-task-list__batch-action-btn--danger"
                      onClick={handleDeleteAllSplitTasks}
                    >
                      全部删除
                    </button>
                  </div>
                </div>
                {filteredTaskList.length === 0 ? (
                  <div className="app-claude-task-list-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可执行任务" />
                  </div>
                ) : null}
                {filteredTaskList.map((task) => {
                  const taskDescription = task.description.trim() || "暂无任务描述";
                  const taskSubtasks = task.subtasks.filter((item) => item.trim().length > 0);
                  const taskDod = task.dod.filter((item) => item.trim().length > 0);
                  const taskDependencies = task.dependencies.filter((item) => item.trim().length > 0);
                  return (
                    <div key={task.id} className="app-claude-task-list__item" data-task-id={task.id}>
                      <div className="app-claude-task-list__body">
                        <div className="app-claude-task-list__left">
                          <div className="app-claude-task-list__title-row">
                            <label className="app-claude-task-list__item-check">
                              <input
                                type="checkbox"
                                checked={taskListSelectedSet.has(task.id)}
                                onChange={(e) => {
                                  const checked = e.currentTarget.checked;
                                  setTaskListSelectedIds((prev) => {
                                    if (checked) {
                                      if (prev.length >= taskListMultiSelectCap) {
                                        void message.info(`最多只能勾选 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                                        return prev;
                                      }
                                      return prev.includes(task.id) ? prev : [...prev, task.id];
                                    }
                                    return prev.filter((id) => id !== task.id);
                                  });
                                }}
                              />
                            </label>
                            <span className="app-claude-task-list__id">{task.id}</span>
                            <span className="app-claude-task-list__title">{task.title || "(未命名任务)"}</span>
                            <Popover
                              trigger="click"
                              placement="leftTop"
                              classNames={{ root: "app-claude-task-list__detail-popover" }}
                              content={(
                                <div className="app-claude-task-list__detail-content">
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">任务描述</div>
                                    <div className="app-claude-task-list__content-text">{taskDescription}</div>
                                  </div>
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">子任务</div>
                                    {taskSubtasks.length > 0 ? (
                                      <ul className="app-claude-task-list__content-list">
                                        {taskSubtasks.map((item, index) => (
                                          <li key={`${task.id}_subtask_${index}`}>{item}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <div className="app-claude-task-list__content-empty">暂无子任务</div>
                                    )}
                                  </div>
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">验收标准</div>
                                    {taskDod.length > 0 ? (
                                      <ul className="app-claude-task-list__content-list">
                                        {taskDod.map((item, index) => (
                                          <li key={`${task.id}_dod_${index}`}>{item}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <div className="app-claude-task-list__content-empty">暂无验收标准</div>
                                    )}
                                  </div>
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">依赖任务</div>
                                    {taskDependencies.length > 0 ? (
                                      <div className="app-claude-task-list__dependency-list">
                                        {taskDependencies.map((item) => (
                                          <span key={`${task.id}_dep_${item}`} className="app-claude-task-list__dependency-tag">
                                            {item}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="app-claude-task-list__content-empty">无依赖</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            >
                              <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__detail-btn">
                                详情
                              </button>
                            </Popover>
                          </div>
                          <div className="app-claude-task-list__meta">
                            <span>角色：{formatTaskRoleLabel(task.role)}</span>
                            <span>规模：{task.size}</span>
                            <span>估时：{task.estimateDays} 天</span>
                            <span className="app-claude-task-list__status">状态：{splitTaskListBinaryLabel(task.flowStatus)}</span>
                            {task.splitSourceTaskId?.trim() ? <span>来源：{task.splitSourceTaskId.trim()}</span> : null}
                          </div>
                          <div className="app-claude-task-list__actions">
                            <div className="app-claude-task-list__action-group">
                              <select
                                className="app-claude-task-list__select"
                                value={task.flowStatus ?? "todo"}
                                onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  if (v !== "todo" && v !== "done") return;
                                  void handleAdjustTaskStatus(task, v);
                                }}
                              >
                                <option value="todo">未完成</option>
                                <option value="done">已完成</option>
                              </select>
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn app-claude-task-list__action-btn--success"
                                onClick={() => {
                                  void handleCompleteTaskManually(task);
                                }}
                              >
                                完成
                              </button>
                              <Popconfirm
                                title="删除该可执行任务？"
                                description="不可撤销；其他任务依赖中会移除对该 id 的引用。"
                                okText="删除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => {
                                  void handleConfirmDeleteSplitTask(task);
                                }}
                              >
                                <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__action-btn--danger">
                                  删除
                                </button>
                              </Popconfirm>
                            </div>
                            <div className="app-claude-task-list__action-group">
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn app-claude-task-list__action-btn--primary"
                                onClick={() => {
                                  void handleRunTaskInMainSession(task);
                                }}
                              >
                                主会话执行
                              </button>
                            </div>
                            <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                              <select
                                className="app-claude-task-list__select"
                                value={task.splitListEmployeeName ?? ""}
                                onChange={(e) => {
                                  void persistSplitTaskDispatchField(task.id, "splitListEmployeeName", e.currentTarget.value);
                                }}
                              >
                                <option value="">选择员工</option>
                                {taskListEmployeeOptions.map((employee) => (
                                  <option key={employee.id} value={employee.name}>
                                    {employee.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn"
                                onClick={() => {
                                  void handleRunTaskByEmployee(task);
                                }}
                              >
                                员工执行
                              </button>
                            </div>
                            <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                              <select
                                className="app-claude-task-list__select"
                                value={task.splitListWorkflowId ?? ""}
                                onChange={(e) => {
                                  void persistSplitTaskDispatchField(task.id, "splitListWorkflowId", e.currentTarget.value);
                                }}
                              >
                                <option value="">选择团队</option>
                                {taskListTeamOptions.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn"
                                onClick={() => {
                                  void handleRunTaskByTeam(task);
                                }}
                              >
                                团队执行
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : null}
            {visibleTrellisTasks.length > 0 ? (
              <div className="app-claude-task-list__section" aria-label="Workspace Trellis 任务">
                <div className="app-claude-task-list__section-head">
                  <div>
                    <div className="app-claude-task-list__section-title">Workspace Trellis</div>
                    <div className="app-claude-task-list__section-subtitle">
                      已落盘到 {activeProject?.rootPath?.trim() || "当前工作区"} 的可继续执行任务
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-claude-task-list__batch-action-btn"
                    disabled={trellisTasksLoading}
                    onClick={() => {
                      void syncTrellisTaskList();
                    }}
                  >
                    刷新
                  </button>
                </div>
                <div className="app-claude-task-list__batch-bar app-claude-task-list__batch-bar--trellis">
                  <label className="app-claude-task-list__batch-check">
                    <input
                      type="checkbox"
                      disabled={trellisTaskSelectableKeys.length === 0}
                      checked={trellisTaskAllSelected}
                      onChange={(e) => {
                        if (e.currentTarget.checked) {
                          const next = trellisTaskSelectableKeys.slice();
                          setTrellisTaskSelectedKeys(next);
                          if (visibleTrellisTasks.length > taskListMultiSelectCap) {
                            void message.info(
                              `当前共 ${visibleTrellisTasks.length} 条，已自动只选前 ${taskListMultiSelectCap} 条（单次批量多选上限）。`,
                            );
                          }
                          return;
                        }
                        setTrellisTaskSelectedKeys([]);
                      }}
                    />
                    <span>全选</span>
                  </label>
                  <span className="app-claude-task-list__batch-count">
                    已选 {trellisTaskSelectedKeys.length} / {taskListMultiSelectCap}
                  </span>
                  <div className="app-claude-task-list__batch-actions">
                    <select
                      className="app-claude-task-list__batch-filter"
                      value={trellisBatchEmployeeName}
                      disabled={!trellisEmployeeDispatchAvailable}
                      title={trellisEmployeeDispatchAvailable ? undefined : "当前工作区暂无可派发员工"}
                      onChange={(e) => {
                        const name = e.currentTarget.value;
                        setTrellisBatchEmployeeName(name);
                        setTrellisTaskEmployeeByKey((prev) => {
                          const next = { ...prev };
                          for (const key of trellisTaskSelectedKeys) {
                            if (name.trim()) next[key] = name;
                            else delete next[key];
                          }
                          return next;
                        });
                      }}
                    >
                      <option value="">批量员工</option>
                      {taskListEmployeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.name}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="app-claude-task-list__batch-action-btn"
                      disabled={!trellisEmployeeDispatchAvailable || trellisTaskSelectedKeys.length === 0}
                      onClick={handleBatchRunTrellisByEmployee}
                    >
                      批量员工执行
                    </button>
                    <button
                      type="button"
                      className="app-claude-task-list__batch-action-btn app-claude-task-list__batch-action-btn--danger"
                      disabled={trellisTaskSelectedKeys.length === 0}
                      onClick={handleBatchArchiveTrellisTasks}
                    >
                      批量删除
                    </button>
                  </div>
                </div>
                {visibleTrellisTasks.map((task) => {
                  const taskPath = getTrellisTaskRelativePath(task);
                  const rowKey = trellisTaskRowKey(task);
                  const rowEmployeeName = trellisTaskEmployeeByKey[rowKey] ?? "";
                  return (
                    <div
                      key={rowKey}
                      className="app-claude-task-list__item app-claude-task-list__item--trellis"
                      data-task-id={task.taskId}
                    >
                      <div className="app-claude-task-list__body">
                        <div className="app-claude-task-list__left">
                          <div className="app-claude-task-list__title-row">
                            <label className="app-claude-task-list__item-check">
                              <input
                                type="checkbox"
                                checked={trellisTaskSelectedSet.has(rowKey)}
                                onChange={(e) => {
                                  const checked = e.currentTarget.checked;
                                  setTrellisTaskSelectedKeys((prev) => {
                                    if (checked) {
                                      if (prev.length >= taskListMultiSelectCap) {
                                        void message.info(`最多只能勾选 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                                        return prev;
                                      }
                                      return prev.includes(rowKey) ? prev : [...prev, rowKey];
                                    }
                                    return prev.filter((key) => key !== rowKey);
                                  });
                                }}
                              />
                            </label>
                            <span className="app-claude-task-list__id">{task.taskId}</span>
                            <span className="app-claude-task-list__title">{task.title || "(未命名任务)"}</span>
                            <Popover
                              trigger="click"
                              placement="leftTop"
                              classNames={{ root: "app-claude-task-list__detail-popover" }}
                              content={(
                                <div className="app-claude-task-list__detail-content">
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">任务路径</div>
                                    <div className="app-claude-task-list__content-text">{taskPath}</div>
                                  </div>
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">来源需求</div>
                                    {task.sourceRequirementIds.length > 0 ? (
                                      <div className="app-claude-task-list__dependency-list">
                                        {task.sourceRequirementIds.map((item) => (
                                          <span key={`${task.taskId}_req_${item}`} className="app-claude-task-list__dependency-tag">
                                            {item}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="app-claude-task-list__content-empty">暂无来源需求映射</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            >
                              <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__detail-btn">
                                详情
                              </button>
                            </Popover>
                          </div>
                          <div className="app-claude-task-list__meta">
                            <span className="app-claude-task-list__status">状态：{task.status || "unknown"}</span>
                            {task.parent?.trim() ? <span>父任务：{task.parent.trim()}</span> : null}
                            {task.clusterId?.trim() ? <span>分片：{task.clusterId.trim()}</span> : null}
                            <span>路径：{taskPath}</span>
                          </div>
                          <div className="app-claude-task-list__actions">
                            <div className="app-claude-task-list__action-group">
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn app-claude-task-list__action-btn--primary"
                                onClick={() => {
                                  void handleRunTrellisTaskInMainSession(task);
                                }}
                              >
                                主会话执行
                              </button>
                              <Popconfirm
                                title="删除该 Trellis 任务？"
                                description="将归档到 .trellis/tasks/archive/ 并从当前列表移除，子目录一并移走。"
                                okText="删除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => {
                                  void handleArchiveTrellisTask(task);
                                }}
                              >
                                <button
                                  type="button"
                                  className="app-claude-task-list__action-btn app-claude-task-list__action-btn--danger"
                                >
                                  删除
                                </button>
                              </Popconfirm>
                            </div>
                            <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                              <select
                                className="app-claude-task-list__select"
                                value={rowEmployeeName}
                                disabled={!trellisEmployeeDispatchAvailable}
                                title={trellisEmployeeDispatchAvailable ? undefined : "当前工作区暂无可派发员工"}
                                onChange={(e) => {
                                  const name = e.currentTarget.value;
                                  setTrellisTaskEmployeeByKey((prev) => {
                                    const next = { ...prev };
                                    if (!name.trim()) delete next[rowKey];
                                    else next[rowKey] = name;
                                    return next;
                                  });
                                }}
                              >
                                <option value="">选择员工</option>
                                {taskListEmployeeOptions.map((employee) => (
                                  <option key={employee.id} value={employee.name}>
                                    {employee.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn"
                                disabled={!trellisEmployeeDispatchAvailable}
                                onClick={() => {
                                  void handleRunTrellisTaskByEmployee(task);
                                }}
                              >
                                员工执行
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Drawer>
  );
});
