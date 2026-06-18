import { DeleteOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from "antd";
import type { FormInstance } from "antd";
import { useMemo, useState } from "react";
import {
  WORKFLOW_KNOWLEDGE_BUILTIN_VARIABLES,
  WORKFLOW_KNOWLEDGE_NODE_KIND_OPTIONS,
  WORKFLOW_KNOWLEDGE_OUTPUT_MODE_OPTIONS,
  WORKFLOW_KNOWLEDGE_SEARCH_MODE_OPTIONS,
  previewKnowledgeConfig,
} from "../../services/workflowKnowledgeRetrieval";
import type { WorkflowKnowledgeRetrievalConfig } from "../../types/workflowKnowledge";
import { DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG } from "../../types/workflowKnowledge";
import type { WorkflowKnowledgeSubgraphDirection } from "../../types/workflowKnowledge";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

export interface WorkflowKnowledgeNodeFormValues {
  title: string;
  query: string;
  searchMode: WorkflowKnowledgeRetrievalConfig["searchMode"];
  nodeKinds: WorkflowKnowledgeRetrievalConfig["nodeKinds"];
  topK: number;
  subgraphHop: number;
  subgraphDirection: WorkflowKnowledgeSubgraphDirection;
  pathPrefix: string;
  outputMode: WorkflowKnowledgeRetrievalConfig["outputMode"];
  requireCitation: boolean;
  outputVariable: string;
  supplementQueries: string[];
}

const DIRECTION_OPTIONS: { value: WorkflowKnowledgeSubgraphDirection; label: string }[] = [
  { value: "both", label: "双向" },
  { value: "upstream", label: "上卷（依赖/调用方）" },
  { value: "downstream", label: "下钻（被引用/被调用）" },
];

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowKnowledgeNodeFormValues>;
  variableOptions: { value: string; label: string }[];
  taskContentPreview?: string;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowKnowledgeNodeEditModal({
  editingNode,
  form,
  variableOptions,
  taskContentPreview = "",
  onCancel,
  onSubmit,
}: Props) {
  const [showPreview, setShowPreview] = useState(true);
  const watched = Form.useWatch([], form);
  const searchMode = watched?.searchMode ?? form.getFieldValue("searchMode") ?? "hybrid";

  const insertSources = useMemo(() => {
    const builtins = WORKFLOW_KNOWLEDGE_BUILTIN_VARIABLES.map((item) => ({
      token: `{{${item.name}}}`,
      label: item.label,
    }));
    const fromStart = variableOptions.map((item) => ({
      token: `{{${item.value}}}`,
      label: item.label,
    }));
    return [...fromStart, ...builtins];
  }, [variableOptions]);

  const previewText = useMemo(() => {
    const values = (watched ?? form.getFieldsValue()) as Partial<WorkflowKnowledgeNodeFormValues>;
    const config: WorkflowKnowledgeRetrievalConfig = {
      query: values.query ?? "",
      searchMode: values.searchMode ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.searchMode,
      nodeKinds: values.nodeKinds ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.nodeKinds,
      topK: values.topK ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.topK,
      subgraphHop: values.subgraphHop ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.subgraphHop,
      subgraphDirection: values.subgraphDirection ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.subgraphDirection,
      pathPrefix: values.pathPrefix?.trim() || undefined,
      outputMode: values.outputMode ?? DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.outputMode,
      requireCitation: Boolean(values.requireCitation),
      outputVariable: values.outputVariable?.trim() || undefined,
      supplementQueries: (values.supplementQueries ?? []).map((item) => String(item ?? "").trim()).filter(Boolean),
    };
    const variables = Object.fromEntries(variableOptions.map((item) => [item.value, ""]));
    return previewKnowledgeConfig(config, {
      variables,
      taskContent: taskContentPreview,
    });
  }, [watched, form, variableOptions, taskContentPreview]);

  function appendToQuery(token: string) {
    const current = String(form.getFieldValue("query") ?? "");
    form.setFieldValue("query", `${current}${token}`);
  }

  return (
    <Modal
      title="编辑 · 知识检索"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal app-workflow-knowledge-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={800}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{
          title: "知识检索",
          query: "",
          searchMode: "hybrid",
          nodeKinds: DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG.nodeKinds,
          topK: 20,
          subgraphHop: 2,
          subgraphDirection: "both",
          pathPrefix: "",
          outputMode: "structured",
          requireCitation: true,
          outputVariable: "",
          supplementQueries: [],
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="知识检索" />
        </Form.Item>

        <Space wrap style={{ width: "100%", marginBottom: 8 }}>
          <Form.Item label="检索模式" name="searchMode" style={{ marginBottom: 0, minWidth: 160 }}>
            <Select
              size="small"
              options={WORKFLOW_KNOWLEDGE_SEARCH_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Top K" name="topK" style={{ marginBottom: 0, minWidth: 100 }}>
            <InputNumber size="small" min={1} max={200} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="子图 Hop" name="subgraphHop" style={{ marginBottom: 0, minWidth: 100 }}>
            <InputNumber size="small" min={0} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="扩展方向" name="subgraphDirection" style={{ marginBottom: 0, minWidth: 180 }}>
            <Select size="small" options={DIRECTION_OPTIONS} />
          </Form.Item>
        </Space>

        <Typography.Paragraph type="secondary" className="app-workflow-node-edit-form__hint">
          {WORKFLOW_KNOWLEDGE_SEARCH_MODE_OPTIONS.find((item) => item.value === searchMode)?.hint}
        </Typography.Paragraph>

        <Form.Item label="节点类型过滤" name="nodeKinds">
          <Select
            size="small"
            mode="multiple"
            allowClear
            placeholder="默认 symbol / file / API"
            options={WORKFLOW_KNOWLEDGE_NODE_KIND_OPTIONS}
          />
        </Form.Item>

        <Form.Item
          label="路径前缀（可选）"
          name="pathPrefix"
          extra={searchMode === "path_focus" ? "路径聚焦模式下建议填写，如 src/services" : undefined}
        >
          <Input size="small" placeholder="例如：src/components/WorkflowConfigModal" />
        </Form.Item>

        <div className="app-workflow-knowledge-edit-modal__var-bar">
          <Typography.Text type="secondary" className="app-workflow-knowledge-edit-modal__var-label">
            插入变量到主检索语句：
          </Typography.Text>
          <Space wrap size={[4, 4]}>
            {insertSources.map((item) => (
              <Button key={item.token} size="small" type="dashed" onClick={() => appendToQuery(item.token)}>
                {item.label}
              </Button>
            ))}
          </Space>
        </div>

        <Form.Item label="主检索语句" name="query" rules={[{ required: true, message: "请输入检索语句" }]}>
          <Input.TextArea rows={3} placeholder="例如：与 {{topic}} 相关的 API 路由与数据模型" />
        </Form.Item>

        <Typography.Text strong className="app-workflow-knowledge-edit-modal__section-title">
          补充检索语句
        </Typography.Text>
        <Typography.Paragraph type="secondary" className="app-workflow-node-edit-form__hint">
          可选；与主查询为 OR 关系，用于同义词或拆分意图。
        </Typography.Paragraph>
        <Form.List name="supplementQueries">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div key={field.key} className="app-workflow-knowledge-edit-modal__supplement-row">
                  <Form.Item {...field} name={field.name} style={{ flex: 1, marginBottom: 8 }}>
                    <Input size="small" placeholder="补充关键词或自然语言问句" />
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="删除补充语句" />
                </div>
              ))}
              <Button type="dashed" block size="small" icon={<PlusOutlined />} onClick={() => add("")}>
                添加补充检索
              </Button>
            </>
          )}
        </Form.List>

        <Space wrap style={{ width: "100%", marginTop: 12 }}>
          <Form.Item label="输出格式" name="outputMode" style={{ marginBottom: 0, minWidth: 200 }}>
            <Select size="small" options={WORKFLOW_KNOWLEDGE_OUTPUT_MODE_OPTIONS} />
          </Form.Item>
          <Form.Item label="引用出处" name="requireCitation" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch size="small" checkedChildren="必须" unCheckedChildren="可选" />
          </Form.Item>
          <Form.Item label="输出变量名（可选）" name="outputVariable" style={{ marginBottom: 0, minWidth: 200 }}>
            <Input size="small" placeholder="kg_context" />
          </Form.Item>
        </Space>

        <div className="app-workflow-knowledge-edit-modal__preview-toolbar">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setShowPreview((prev) => !prev)}>
            {showPreview ? "隐藏派发预览" : "显示派发预览"}
          </Button>
        </div>
        {showPreview ? (
          <div className="app-workflow-knowledge-edit-modal__preview">
            <Typography.Text strong>派发预览</Typography.Text>
            <Typography.Text type="secondary" className="app-workflow-knowledge-edit-modal__preview-hint">
              以下为注入下游 Agent 的图谱检索说明。
            </Typography.Text>
            <pre className="app-workflow-knowledge-edit-modal__preview-body">{previewText}</pre>
          </div>
        ) : null}
      </Form>
    </Modal>
  );
}
