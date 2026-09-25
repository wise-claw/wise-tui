import { useEffect, useState } from "react";
import { App as AntApp, Form, Input, Modal, Select } from "antd";
import {
  createCollabResource,
  formatCollabError,
  projectSelectOptions,
  repositoryWorkspaceLabel,
  RESOURCE_KIND_LABELS,
  RESOURCE_VISIBILITY_LABELS,
} from "../../../services/collaboration";
import type { CollabResourceVisibility } from "../../../types/collaboration";
import type { CollabDirectory } from "./useCollabDirectory";

interface Props {
  open: boolean;
  directory: CollabDirectory;
  presetProjectId?: string | null;
  onClose: () => void;
  onCreated: (resourceId: string) => void;
}

interface FormValues {
  title: string;
  kind: string;
  ownerProjectId?: string;
  ownerAgentId?: string;
  maintainer?: string;
  visibility: CollabResourceVisibility;
  spaceId?: string;
  repositoryId?: number;
  location?: string;
  content: string;
  note?: string;
}

/** 发布共享资源的首个版本；凭据类内容会被后端拒绝，只允许填写凭据标识。 */
export function CollabResourceCreateModal({ open, directory, presetProjectId, onClose, onCreated }: Props) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const visibility = Form.useWatch("visibility", form);
  const ownerProjectId = Form.useWatch("ownerProjectId", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ kind: "knowledge", visibility: "source", ownerProjectId: presetProjectId ?? undefined });
  }, [form, open, presetProjectId]);

  const project = directory.projects.find((p) => p.id === ownerProjectId);
  const repoOptions = directory.repositories
    .filter((r) => !project || project.repositoryIds.includes(r.id))
    .map((r) => ({ value: r.id, label: repositoryWorkspaceLabel(r) }));

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const res = await createCollabResource({
        title: v.title,
        kind: v.kind,
        content: v.content,
        ownerProjectId: v.ownerProjectId ?? null,
        ownerAgentId: v.ownerAgentId ?? null,
        maintainer: v.maintainer ?? "",
        visibility: v.visibility,
        spaceId: v.visibility === "space" ? v.spaceId ?? null : null,
        repositoryId: v.repositoryId ?? null,
        location: v.location ?? "",
        note: v.note ?? "",
      });
      message.success("已发布 v1");
      onCreated(res.id);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="发布共享资源" okText="发布" confirmLoading={saving} width={640} onOk={() => void submit()} onCancel={onClose} destroyOnClose>
      <Form form={form} layout="vertical" size="small">
        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
          <Input placeholder="如：账号接入规范" />
        </Form.Item>
        <Form.Item name="kind" label="类型">
          <Select options={Object.entries(RESOURCE_KIND_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="ownerProjectId" label="来源项目" tooltip="来源项目或来源智能体至少选一个">
          <Select allowClear options={projectSelectOptions(directory.projects, directory.repositories)} />
        </Form.Item>
        <Form.Item name="ownerAgentId" label="来源智能体">
          <Select allowClear options={directory.agents.map((a) => ({ value: a.id, label: a.name }))} />
        </Form.Item>
        <Form.Item name="repositoryId" label="来源仓库">
          <Select allowClear options={repoOptions} />
        </Form.Item>
        <Form.Item name="location" label="文档位置">
          <Input placeholder="仓库内路径或文档链接，如 docs/auth.md" />
        </Form.Item>
        <Form.Item name="maintainer" label="维护者">
          <Input />
        </Form.Item>
        <Form.Item name="visibility" label="可见范围" extra={RESOURCE_VISIBILITY_LABELS[visibility ?? "source"]?.hint}>
          <Select options={Object.entries(RESOURCE_VISIBILITY_LABELS).map(([value, v]) => ({ value, label: v.label }))} />
        </Form.Item>
        {visibility === "space" ? (
          <Form.Item name="spaceId" label="协作空间" rules={[{ required: true, message: "请选择协作空间" }]}>
            <Select options={directory.spaces.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
        ) : null}
        <Form.Item name="content" label="内容" rules={[{ required: true, message: "请输入内容" }]}>
          <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} placeholder="规范、接口说明、环境说明等；凭据只填写标识，不要粘贴密钥" />
        </Form.Item>
        <Form.Item name="note" label="版本说明">
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
