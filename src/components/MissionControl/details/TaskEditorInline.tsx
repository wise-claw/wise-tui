import { Alert, Button, Form, Input, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "../copy";
import type { TaskEvidenceVM } from "../presenter/types";
import { ListEditor } from "./ListEditor";

interface TaskEditorInlineProps {
  evidence: TaskEvidenceVM;
  onPatchTitle: (clusterId: string, taskId: string, title: string, isManual: boolean) => void;
  onPatchDescription: (clusterId: string, taskId: string, description: string, isManual: boolean) => void;
  onPatchRole: (clusterId: string, taskId: string, role: TaskEvidenceVM["role"], isManual: boolean) => void;
  onPatchTaskList: (clusterId: string, taskId: string, field: "subtasks" | "dod", items: string[], isManual: boolean) => void;
  onDeleteTask: (clusterId: string, taskId: string) => void;
  onRestoreTask: (clusterId: string, taskId: string) => void;
  onAddTask: (clusterId: string, sourceRequirementIds: string[]) => string | null;
}

export function TaskEditorInline({
  evidence,
  onPatchTitle,
  onPatchDescription,
  onPatchRole,
  onPatchTaskList,
  onDeleteTask,
  onRestoreTask,
  onAddTask,
}: TaskEditorInlineProps) {
  const [title, setTitle] = useState(evidence.title);
  const [description, setDescription] = useState(evidence.description);
  useEffect(() => {
    setTitle(evidence.title);
    setDescription(evidence.description);
  }, [evidence.description, evidence.title, evidence.taskId]);
  return (
    <Form layout="vertical" size="small" className="mission-task-editor" component="div">
      <Form.Item label="标题">
        <Space.Compact className="mission-task-editor__compact">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <Button onClick={() => onPatchTitle(evidence.clusterId, evidence.taskId, title, evidence.isManual)}>
            保存
          </Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item label="角色">
        <Select
          value={evidence.role ?? undefined}
          placeholder="选择角色"
          onChange={(role) => onPatchRole(evidence.clusterId, evidence.taskId, role, evidence.isManual)}
          options={(Object.keys(ROLE_LABEL) as Array<keyof typeof ROLE_LABEL>).map((role) => ({
            value: role,
            label: ROLE_LABEL[role],
          }))}
        />
      </Form.Item>
      <Form.Item label="说明">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 5 }}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => onPatchDescription(evidence.clusterId, evidence.taskId, description, evidence.isManual)}
        />
      </Form.Item>
      <Form.Item label={`子项 (${evidence.subtasks.length})`}>
        <ListEditor
          items={evidence.subtasks}
          placeholder="添加一条子项"
          onChange={(items) => onPatchTaskList(evidence.clusterId, evidence.taskId, "subtasks", items, evidence.isManual)}
        />
      </Form.Item>
      <Form.Item label={`验收标准 (${evidence.dod.length})`}>
        <ListEditor
          items={evidence.dod}
          placeholder="添加一条验收标准"
          onChange={(items) => onPatchTaskList(evidence.clusterId, evidence.taskId, "dod", items, evidence.isManual)}
        />
      </Form.Item>
      <Popconfirm
        title="删除任务"
        description="落盘时不会写入这条任务。"
        okText="删除"
        cancelText="取消"
        onConfirm={() => onDeleteTask(evidence.clusterId, evidence.taskId)}
      >
        <Button danger icon={<DeleteOutlined />}>
          删除任务
        </Button>
      </Popconfirm>
      <Button
        icon={<PlusOutlined />}
        onClick={() => onAddTask(evidence.clusterId, evidence.sourceRequirements.map((item) => item.id))}
      >
        新增同组任务
      </Button>
      {evidence.technical.deletedTaskIds.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`已剔除 ${evidence.technical.deletedTaskIds.length} 个任务`}
          description={
            <Space wrap size={4}>
              {evidence.technical.deletedTaskIds.map((taskId) => (
                <Tag key={taskId}>
                  <Typography.Text code>{taskId}</Typography.Text>
                  <Button
                    size="small"
                    type="link"
                    icon={<UndoOutlined />}
                    onClick={() => onRestoreTask(evidence.clusterId, taskId)}
                  >
                    恢复
                  </Button>
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}
    </Form>
  );
}
