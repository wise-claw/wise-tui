import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Form, Input, Modal, Select, Typography } from "antd";
import { listAssistants } from "../../../services/assistants";
import {
  bindCollabAgent,
  buildCollabAgentInitialConfig,
  COLLAB_AGENT_TEMPLATES,
  createCollabAgent,
  ensureRepositoryProject,
  findCollabAgentTemplate,
  formatCollabError,
  getCollabCapabilityMatrix,
  repositorySelectOptions,
  repositoryWorkspaceLabel,
} from "../../../services/collaboration";
import { listProjects } from "../../../services/projectState";
import { loadRepositories } from "../../../services/repository";
import type { ProjectItem, Repository } from "../../../types";
import type { AssistantEntry } from "../../../types/assistant";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (agentId: string) => void;
  /** 从仓库 / 项目设置进入时预选。 */
  presetProjectId?: string | null;
  presetRepositoryIds?: number[];
}

interface FormState {
  name: string;
  description: string;
  templateId: string | null;
  assistantId: string | null;
  engineId: string;
  repositoryIds: number[];
}

/** 创建仓库智能体：名称必填；模板、助手基线、绑定仓库均可选，六项配置可以之后再补。 */
export function CollabAgentCreateModal({ open, onClose, onCreated, presetProjectId, presetRepositoryIds }: Props) {
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [assistants, setAssistants] = useState<AssistantEntry[]>([]);
  const [engines, setEngines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    templateId: "fullstack",
    assistantId: null,
    engineId: "claude",
    repositoryIds: [],
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: "",
      description: "",
      templateId: "fullstack",
      assistantId: null,
      engineId: "claude",
      repositoryIds: presetRepositoryIds ?? [],
    });
    void Promise.all([listProjects(), loadRepositories()])
      .then(([rows, repos]) => {
        setProjects(rows);
        setRepositories(repos);
        if (presetRepositoryIds?.length) return;
        if (!presetProjectId) return;
        const project = rows.find((p) => p.id === presetProjectId);
        if (!project) return;
        const ids = project.repositoryIds.filter((id) => repos.some((r) => r.id === id));
        if (ids.length) setForm((f) => ({ ...f, repositoryIds: f.repositoryIds.length ? f.repositoryIds : ids }));
      })
      .catch(() => {
        setProjects([]);
        setRepositories([]);
      });
    void listAssistants()
      .then(setAssistants)
      .catch(() => setAssistants([]));
    void getCollabCapabilityMatrix()
      .then((m) => setEngines(Object.keys(m)))
      .catch(() => setEngines([]));
  }, [open, presetProjectId, presetRepositoryIds]);

  const repoOptions = useMemo(
    () => repositorySelectOptions(repositories, projects),
    [projects, repositories],
  );

  const template = findCollabAgentTemplate(form.templateId);

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      message.warning("请填写智能体名称");
      return;
    }
    setBusy(true);
    try {
      const assistant = assistants.find((a) => a.id === form.assistantId) ?? null;
      let directory = projects;
      const bound: { repositoryId: number; projectId: string }[] = [];
      for (const repositoryId of form.repositoryIds) {
        const repo = repositories.find((r) => r.id === repositoryId);
        if (!repo) continue;
        const ensured = await ensureRepositoryProject(directory, repo, presetProjectId);
        directory = ensured.projects;
        bound.push({ repositoryId, projectId: ensured.projectId });
      }
      const profile = await createCollabAgent({
        name,
        description: form.description.trim() || template?.description || "",
        avatarColor: assistant?.avatarColor ?? null,
        assistantId: assistant?.id ?? null,
        defaultOwnerProjectId: bound[0]?.projectId ?? presetProjectId ?? null,
        config: buildCollabAgentInitialConfig({ templateId: form.templateId, assistant, engineId: form.engineId }),
      });
      const failed: string[] = [];
      for (const [idx, item] of bound.entries()) {
        try {
          await bindCollabAgent({
            agentId: profile.id,
            projectId: item.projectId,
            repositoryId: item.repositoryId,
            roleTags: template?.roleTags ?? [],
            isDefault: idx === 0,
          });
        } catch (e) {
          const repo = repositories.find((r) => r.id === item.repositoryId);
          failed.push(`${repo ? repositoryWorkspaceLabel(repo) : item.repositoryId}：${formatCollabError(e)}`);
        }
      }
      if (failed.length) message.warning(`已创建，部分仓库绑定失败：${failed.join("；")}`);
      else message.success("已创建智能体草稿，检查并发布后即可接收需求");
      onCreated(profile.id);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="新建仓库智能体" okText="创建" confirmLoading={busy} onOk={() => void submit()} onCancel={onClose} destroyOnClose>
      <Form layout="vertical" size="small">
        <Form.Item label="名称" required>
          <Input autoFocus maxLength={60} placeholder="例如：订单研发" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Form.Item>
        <Form.Item label="职责说明">
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder={template?.description}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="初始模板" extra="模板只在创建时复制，之后独立修改；模板更新时只提示。">
          <Select
            allowClear
            placeholder="空白"
            value={form.templateId ?? undefined}
            options={COLLAB_AGENT_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.description}` }))}
            onChange={(v?: string) => setForm({ ...form, templateId: v ?? null })}
          />
        </Form.Item>
        <Form.Item label="基于现有助手（可选）" extra="复制助手的技能、MCP 与模型作为起点，不与助手联动。">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={form.assistantId ?? undefined}
            options={assistants.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v?: string) => setForm({ ...form, assistantId: v ?? null })}
          />
        </Form.Item>
        <Form.Item label="执行环境">
          <Select
            value={form.engineId}
            options={(engines.length ? engines : ["claude"]).map((e) => ({ value: e, label: e }))}
            onChange={(v: string) => setForm({ ...form, engineId: v })}
          />
        </Form.Item>
        <Form.Item label="绑定仓库" extra="选项与左侧工作区列表一致。一个智能体可以绑定多个仓库，按仓库拆任务并以同一身份执行。">
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            placeholder="选择要绑定的工作区仓库"
            value={form.repositoryIds}
            options={repoOptions}
            onChange={(v: number[]) => setForm({ ...form, repositoryIds: v })}
          />
        </Form.Item>
        <Typography.Text type="secondary">知识、记忆、技能、MCP 可在创建后按需配置，不必一次填满。</Typography.Text>
      </Form>
    </Modal>
  );
}
