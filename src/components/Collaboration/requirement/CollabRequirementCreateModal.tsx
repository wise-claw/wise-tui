import { useEffect, useMemo, useState } from "react";
import { Alert, App as AntApp, Checkbox, Form, Input, InputNumber, Modal, Radio, Select, Space, Typography } from "antd";
import {
  createCollabRequirement,
  formatCollabError,
  newCollabRequestId,
  projectSelectOptions,
  repositoryWorkspaceLabel,
} from "../../../services/collaboration";
import { closeCollabRequirementCreate, openCollabRequirementDetail, useCollabRequirementCreate } from "../../../stores/collabUiStore";
import { useCollabDirectory } from "../resources/useCollabDirectory";

interface FormValues {
  title?: string;
  body: string;
  ownerAgentId: string;
  ownerProjectId: string;
  participantProjectIds: string[];
  collaborationMode: "serial" | "contract_parallel";
  planApprovalRequired: boolean;
  acceptancePolicy: "manual" | "machine" | "agent_default";
  maxConcurrentAttempts?: number;
  executionAttemptBudget?: number;
  repairRoundBudget?: number;
  budgetMinutes?: number;
}

/** 新建多仓库协作需求：主责智能体/项目、参与项目、协作方式、计划确认与预算；仓库任务由主责智能体规划。 */
export function CollabRequirementCreateModal() {
  const preset = useCollabRequirementCreate();
  const open = preset != null;
  const { message } = AntApp.useApp();
  const directory = useCollabDirectory(open);
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(() => newCollabRequestId("create"));
  const ownerAgentId = Form.useWatch("ownerAgentId", form);
  const ownerProjectId = Form.useWatch("ownerProjectId", form);
  const participants = Form.useWatch("participantProjectIds", form) ?? [];

  const enabledAgents = useMemo(() => directory.agents.filter((a) => a.status === "enabled"), [directory.agents]);
  const agent = enabledAgents.find((a) => a.id === ownerAgentId);
  const agentProjects = useMemo(
    () => [...new Set((agent?.bindings ?? []).filter((b) => b.status === "active").map((b) => b.projectId))],
    [agent],
  );

  useEffect(() => {
    if (!open) return;
    setRequestId(newCollabRequestId("create"));
    form.resetFields();
    form.setFieldsValue({
      body: preset?.body ?? "",
      ownerProjectId: preset?.projectId ?? undefined,
      participantProjectIds: [],
      collaborationMode: "serial",
      planApprovalRequired: false,
      acceptancePolicy: "agent_default",
    });
  }, [form, open, preset]);

  useEffect(() => {
    if (!agent) return;
    const current = form.getFieldValue("ownerProjectId") as string | undefined;
    if (current && agentProjects.includes(current)) return;
    const next = agent.defaultOwnerProjectId && agentProjects.includes(agent.defaultOwnerProjectId) ? agent.defaultOwnerProjectId : agentProjects[0];
    if (next) form.setFieldValue("ownerProjectId", next);
  }, [agent, agentProjects, form]);

  const reposInScope = useMemo(() => {
    const ids = new Set([ownerProjectId, ...participants].filter(Boolean));
    const repoIds = new Set(directory.projects.filter((p) => ids.has(p.id)).flatMap((p) => p.repositoryIds));
    return directory.repositories.filter((r) => repoIds.has(r.id));
  }, [directory.projects, directory.repositories, ownerProjectId, participants]);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const req = await createCollabRequirement({
        requestId,
        title: v.title?.trim() || null,
        body: v.body,
        ownerAgentId: v.ownerAgentId,
        ownerProjectId: v.ownerProjectId,
        participantProjectIds: v.participantProjectIds ?? [],
        imagePaths: preset?.imagePaths ?? [],
        planApprovalRequired: v.planApprovalRequired,
        collaborationMode: v.collaborationMode,
        acceptancePolicy: v.acceptancePolicy === "agent_default" ? null : v.acceptancePolicy,
        maxConcurrentAttempts: v.maxConcurrentAttempts ?? null,
        executionAttemptBudget: v.executionAttemptBudget ?? null,
        repairRoundBudget: v.repairRoundBudget ?? null,
        budgetMs: v.budgetMinutes ? v.budgetMinutes * 60_000 : null,
      });
      message.success("协作需求已创建，主责智能体开始规划");
      closeCollabRequirementCreate();
      openCollabRequirementDetail(req.id);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setSaving(false);
    }
  };

  const imageCount = preset?.imagePaths?.length ?? 0;

  return (
    <Modal
      open={open}
      title="新建多仓库协作需求"
      okText="创建并规划"
      width={720}
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={closeCollabRequirementCreate}
      destroyOnClose
    >
      {enabledAgents.length === 0 ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="还没有已启用的仓库智能体，请先在 Hub 的“仓库智能体”中新建、绑定仓库并启用。" />
      ) : null}
      <Form form={form} layout="vertical" size="small">
        <Form.Item name="ownerAgentId" label="主责智能体" rules={[{ required: true, message: "请选择主责智能体" }]} extra="主责智能体负责拆分仓库任务、协调接口与修正、组织验收。">
          <Select showSearch optionFilterProp="label" options={enabledAgents.map((a) => ({ value: a.id, label: a.name }))} />
        </Form.Item>
        <Space.Compact block>
          <Form.Item name="ownerProjectId" label="主责项目" rules={[{ required: true, message: "请选择主责项目" }]} style={{ flex: 1 }}>
            <Select
              options={projectSelectOptions(directory.projects, directory.repositories).map((o) => ({
                ...o,
                label: agentProjects.length && !agentProjects.includes(o.value) ? `${o.label}（智能体未绑定）` : o.label,
              }))}
            />
          </Form.Item>
          <Form.Item name="participantProjectIds" label="参与项目" style={{ flex: 1, marginInlineStart: 8 }}>
            <Select
              mode="multiple"
              allowClear
              options={projectSelectOptions(directory.projects, directory.repositories).filter((o) => o.value !== ownerProjectId)}
            />
          </Form.Item>
        </Space.Compact>
        {reposInScope.length ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
            可规划的仓库：{reposInScope.map((r) => repositoryWorkspaceLabel(r)).join("、")}（规划超出范围时会先请求授权）
          </Typography.Paragraph>
        ) : null}
        <Form.Item name="title" label="标题">
          <Input placeholder="留空则从正文生成" />
        </Form.Item>
        <Form.Item name="body" label="需求内容" rules={[{ required: true, whitespace: true, message: "请输入需求内容" }]} extra={imageCount ? `附带 ${imageCount} 张图片` : undefined}>
          <Input.TextArea autoSize={{ minRows: 5, maxRows: 14 }} placeholder="描述目标、约束与验收标准" />
        </Form.Item>
        <Form.Item name="collaborationMode" label="协作方式">
          <Radio.Group
            options={[
              { value: "serial", label: "按依赖串行" },
              { value: "contract_parallel", label: "先定接口再并行" },
            ]}
          />
        </Form.Item>
        <Space size={24} wrap>
          <Form.Item name="planApprovalRequired" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>计划需我确认后再执行</Checkbox>
          </Form.Item>
          <Form.Item name="acceptancePolicy" label="验收方式" style={{ marginBottom: 8 }}>
            <Select
              style={{ width: 180 }}
              options={[
                { value: "agent_default", label: "沿用智能体策略" },
                { value: "manual", label: "人工验收" },
                { value: "machine", label: "证据齐全自动验收" },
              ]}
            />
          </Form.Item>
        </Space>
        <Space size={12} wrap>
          <Form.Item name="maxConcurrentAttempts" label="并发上限">
            <InputNumber min={1} max={8} placeholder="默认" />
          </Form.Item>
          <Form.Item name="executionAttemptBudget" label="执行次数">
            <InputNumber min={1} max={20} placeholder="默认" />
          </Form.Item>
          <Form.Item name="repairRoundBudget" label="修正轮数">
            <InputNumber min={1} max={20} placeholder="默认" />
          </Form.Item>
          <Form.Item name="budgetMinutes" label="时间预算（分钟）">
            <InputNumber min={1} placeholder="不限" />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
