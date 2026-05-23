import { Alert, Button, Form, Input, Select, Switch, Typography } from "antd";
import type { FormInstance } from "antd";
import type { EmployeeItem } from "../../types";
import { WorkflowCanvasEditor as WorkflowCanvasEditorImpl } from "./WorkflowCanvasEditor";
import { getWorkflowValidationSuggestion as getWorkflowValidationSuggestionImpl } from "./workflowValidationCopy";
import type { WorkflowConfigModalController } from "./useWorkflowConfigModal";

type Props = {
  loading: boolean;
  employees: EmployeeItem[];
  projects?: { id: string; name: string }[];
  repositoryPath?: string | null;
  selectableEmployeeIds: string[];
  form: FormInstance;
} & Pick<
  WorkflowConfigModalController,
  | "editingTemplate"
  | "editingTemplateId"
  | "editingProjectIds"
  | "setEditingProjectIds"
  | "canvasSnapshot"
  | "setCanvasSnapshot"
  | "validationErrors"
  | "groupedValidationErrors"
  | "resetEditor"
  | "handleSave"
  | "handlePublish"
>;

export function WorkflowConfigEditorPanel({
  loading,
  employees,
  projects,
  repositoryPath,
  selectableEmployeeIds,
  form,
  editingTemplate,
  editingTemplateId,
  editingProjectIds,
  setEditingProjectIds,
  canvasSnapshot,
  setCanvasSnapshot,
  validationErrors,
  groupedValidationErrors,
  resetEditor,
  handleSave,
  handlePublish,
}: Props) {
  return (
    <div className="app-workflow-config-editor">
      <Form
        form={form}
        size="small"
        layout="inline"
        initialValues={{ name: "", isDefault: false }}
        className="app-workflow-config-editor-form"
      >
        <div className="app-workflow-config-editor-form-left">
          <Form.Item name="name">
            <Input placeholder="团队名称" className="app-workflow-config-name-input" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked">
            <Switch checkedChildren="默认" unCheckedChildren="非默认" />
          </Form.Item>
          {projects && projects.length > 0 ? (
            <Form.Item label="所属工作区" colon={false}>
              <Select
                className="app-workflow-config-project-select"
                mode="multiple"
                allowClear
                placeholder="所属工作区"
                maxTagCount="responsive"
                value={editingProjectIds}
                onChange={(value: string[]) => setEditingProjectIds(value)}
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
            </Form.Item>
          ) : null}
        </div>
        <Typography.Text type="secondary" ellipsis className="app-workflow-config-stage-tip">
          流程编排：左侧节点库、右侧画布；支持变量、模板、分支与 Agent 阶段组合
        </Typography.Text>
        <div className="app-workflow-config-editor-form-actions">
          <Form.Item>
            <Button size="small" type="primary" loading={loading} onClick={() => void handleSave()}>
              {editingTemplate ? "保存草稿" : "创建草稿"}
            </Button>
          </Form.Item>
          <Form.Item>
            <Button size="small" loading={loading} onClick={() => void handlePublish()}>
              发布模板
            </Button>
          </Form.Item>
          {editingTemplate ? (
            <Form.Item>
              <Button size="small" onClick={resetEditor}>
                取消编辑
              </Button>
            </Form.Item>
          ) : null}
        </div>
      </Form>

      {validationErrors.length > 0 ? (
        <Alert
          className="app-workflow-config-validation-alert"
          type="error"
          showIcon
          message="流程图校验未通过"
          description={
            <div>
              {groupedValidationErrors.map(([groupTitle, groupItems]) => (
                <div key={groupTitle} className="app-workflow-config-error-group">
                  <Typography.Text strong>{groupTitle}</Typography.Text>
                  {groupItems.map((item) => (
                    <div key={`${item.code}-${item.nodeId ?? ""}-${item.edgeId ?? ""}`}>
                      <Typography.Text>
                        [{item.code}] {item.message}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="app-workflow-config-error-suggestion">
                        建议：{getWorkflowValidationSuggestionImpl(item.code)}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          }
        />
      ) : null}

      <div className="app-workflow-config-stage-panel">
        <WorkflowCanvasEditorImpl
          key={editingTemplateId ?? "new-team-workflow"}
          value={canvasSnapshot}
          onChange={setCanvasSnapshot}
          employees={employees}
          selectableEmployeeIds={selectableEmployeeIds}
          repositoryPath={repositoryPath}
        />
      </div>
    </div>
  );
}
