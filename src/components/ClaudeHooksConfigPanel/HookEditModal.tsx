import { Button, Col, Form, Input, Modal, Row, Select, Space, Switch } from "antd";
import type { FormInstance } from "antd";
import type { ClaudeHookHandler } from "../../types";
import { getSupportedTypesText } from "./helpers";
import type { EditingTarget, HookEditFormValues } from "./types";

interface HookEditModalProps {
  open: boolean;
  editing: EditingTarget;
  form: FormInstance<HookEditFormValues>;
  eventOptions: Array<{ value: string; label: string }>;
  typeOptions: Array<{ value: ClaudeHookHandler["type"]; label: string }>;
  selectedEventName?: string;
  submitting: boolean;
  submittingAndContinue: boolean;
  onClose: () => void;
  onSubmit: (keepOpen: boolean) => void;
}

export function HookEditModal({
  open,
  editing,
  form,
  eventOptions,
  typeOptions,
  selectedEventName,
  submitting,
  submittingAndContinue,
  onClose,
  onSubmit,
}: HookEditModalProps) {
  return (
    <Modal
      title={editing?.handlerId ? "编辑 Hook" : "新增 Hook"}
      open={open}
      onCancel={onClose}
      onOk={() => onSubmit(false)}
      confirmLoading={submitting}
      width={760}
      className="app-hooks-edit-modal"
      destroyOnHidden
      okText={editing?.handlerId ? "保存" : "保存"}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <CancelBtn />
          {!editing?.handlerId ? (
            <Button loading={submittingAndContinue} onClick={() => onSubmit(true)}>
              保存并继续
            </Button>
          ) : null}
          <OkBtn />
        </Space>
      )}
    >
      <Form form={form} layout="vertical" size="small" colon={false} className="app-hooks-edit-form">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="scope" label="范围" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "user", label: "user" },
                  { value: "project", label: "project" },
                  { value: "local", label: "local" },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="eventName" label="事件" rules={[{ required: true }]}>
              <Select options={eventOptions} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <div className="app-hooks-type-hint">
              支持类型：{selectedEventName ? getSupportedTypesText(selectedEventName) : "command / http / mcp_tool / prompt / agent"}
            </div>
          </Col>
          <Col span={12}>
            <Form.Item name="matcher" label="Matcher（可选）">
              <Input placeholder="如 Bash 或 Edit|Write 或 mcp__.*" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={typeOptions} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="if" label="if（可选）">
              <Input placeholder="如 Bash(git *)" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="timeout" label="timeout（秒）">
              <Input type="number" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="statusMessage" label="statusMessage（可选）">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
          {({ getFieldValue }) => {
            const t = getFieldValue("type");
            if (t === "command") {
              return (
                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Item name="command" label="command" rules={[{ required: true, message: "请输入 command" }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="shell" label="shell（可选）">
                      <Select
                        allowClear
                        options={[
                          { value: "bash", label: "bash" },
                          { value: "powershell", label: "powershell" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="async" valuePropName="checked" label="async">
                      <Switch size="small" />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="asyncRewake" valuePropName="checked" label="asyncRewake">
                      <Switch size="small" />
                    </Form.Item>
                  </Col>
                </Row>
              );
            }
            if (t === "http") {
              return (
                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Item name="url" label="url" rules={[{ required: true, message: "请输入 url" }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="headersText" label="headers（每行 Key: Value）">
                      <Input.TextArea rows={3} placeholder={"Authorization: Bearer $TOKEN\nX-Team: dev"} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="allowedEnvVarsText" label="allowedEnvVars（每行一个）">
                      <Input.TextArea rows={3} placeholder={"TOKEN\nAPI_KEY"} />
                    </Form.Item>
                  </Col>
                </Row>
              );
            }
            return (
              <Row gutter={12}>
                <Col span={24}>
                  <Form.Item name="prompt" label="prompt" rules={[{ required: true, message: "请输入 prompt" }]}>
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="model" label="model（可选）">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            );
          }}
        </Form.Item>
      </Form>
    </Modal>
  );
}
