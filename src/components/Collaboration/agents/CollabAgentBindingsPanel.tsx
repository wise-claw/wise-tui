import { useMemo, useState } from "react";
import { App as AntApp, Button, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import {
  bindCollabAgent,
  ensureRepositoryProject,
  formatCollabError,
  ownerProjectForRepository,
  projectWorkspaceLabel,
  repositorySelectOptions,
  repositoryWorkspaceLabel,
  unbindCollabAgent,
} from "../../../services/collaboration";
import type { ProjectItem, Repository } from "../../../types";
import type { CollabAgentBinding, CollabBindingOverride } from "../../../types/collaboration";

interface Props {
  agentId: string;
  bindings: CollabAgentBinding[];
  projects: ProjectItem[];
  repositories: Repository[];
  onChanged: () => Promise<void> | void;
}

interface BindingForm {
  projectId: string;
  repositoryId: number | null;
  responsibility: string;
  roleTags: string[];
  accessScope: "read" | "read_write";
  isDefault: boolean;
  override: CollabBindingOverride;
}

const EMPTY_OVERRIDE: CollabBindingOverride = {
  agentsMd: null,
  knowledgeRefs: [],
  skillsEnable: [],
  skillsDisable: [],
  mcpsEnable: [],
  mcpsDisable: [],
};

function emptyForm(projectId = ""): BindingForm {
  return {
    projectId,
    repositoryId: null,
    responsibility: "",
    roleTags: [],
    accessScope: "read_write",
    isDefault: false,
    override: EMPTY_OVERRIDE,
  };
}

/** 绑定仓库：项目、仓库、角色、职责、读写范围、默认负责，以及仓库专用配置覆盖。 */
export function CollabAgentBindingsPanel({ agentId, bindings, projects, repositories, onChanged }: Props) {
  const { message } = AntApp.useApp();
  const [form, setForm] = useState<BindingForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [showUnbound, setShowUnbound] = useState(false);
  const repoById = useMemo(() => new Map(repositories.map((r) => [r.id, r])), [repositories]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const repoOptions = useMemo(() => repositorySelectOptions(repositories, projects), [projects, repositories]);

  const save = async () => {
    if (!form || form.repositoryId == null) {
      message.warning("请选择要绑定的仓库");
      return;
    }
    const repo = repoById.get(form.repositoryId);
    if (!repo) {
      message.warning("仓库不存在或已从工作区移除");
      return;
    }
    setSaving(true);
    try {
      const ensured = await ensureRepositoryProject(projects, repo, form.projectId || null);
      await bindCollabAgent({
        agentId,
        projectId: ensured.projectId,
        repositoryId: form.repositoryId,
        responsibility: form.responsibility,
        roleTags: form.roleTags,
        accessScope: form.accessScope,
        isDefault: form.isDefault,
        override: form.override,
      });
      message.success("绑定已保存");
      setForm(null);
      await onChanged();
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setSaving(false);
    }
  };

  const rows = bindings.filter((b) => showUnbound || b.status === "active");

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" type="primary" onClick={() => setForm(emptyForm(projects[0]?.id ?? ""))}>
          绑定仓库
        </Button>
        <span>
          显示已解绑 <Switch size="small" checked={showUnbound} onChange={setShowUnbound} />
        </span>
      </Space>
      <Table<CollabAgentBinding>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "尚未绑定仓库；智能体只在绑定仓库内工作" }}
        columns={[
          {
            title: "项目 / 仓库",
            render: (_, b) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>
                  {repoById.get(b.repositoryId)
                    ? repositoryWorkspaceLabel(repoById.get(b.repositoryId)!)
                    : `仓库 #${b.repositoryId}`}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {projectById.get(b.projectId)
                    ? projectWorkspaceLabel(projectById.get(b.projectId)!, repositories)
                    : b.projectId}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "角色 / 职责",
            render: (_, b) => (
              <Space direction="vertical" size={2}>
                <Space size={2} wrap>
                  {b.roleTags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
                <Typography.Text type="secondary">{b.responsibility || "—"}</Typography.Text>
              </Space>
            ),
          },
          {
            title: "范围",
            width: 120,
            render: (_, b) => (
              <Space size={2} wrap>
                <Tag>{b.accessScope === "read" ? "只读" : "读写"}</Tag>
                {b.isDefault ? <Tag color="blue">默认负责</Tag> : null}
                {b.status !== "active" ? <Tag>已解绑</Tag> : null}
              </Space>
            ),
          },
          {
            title: "专用配置",
            width: 110,
            render: (_, b) => {
              const o = b.override;
              const n =
                (o.agentsMd ? 1 : 0) +
                o.knowledgeRefs.length +
                o.skillsEnable.length +
                o.skillsDisable.length +
                o.mcpsEnable.length +
                o.mcpsDisable.length;
              return n ? <Tag color="purple">{n} 项覆盖</Tag> : <Typography.Text type="secondary">无</Typography.Text>;
            },
          },
          {
            title: "操作",
            width: 130,
            render: (_, b) =>
              b.status === "active" ? (
                <Space size={0}>
                  <Button
                    size="small"
                    type="link"
                    onClick={() =>
                      setForm({
                        projectId: b.projectId,
                        repositoryId: b.repositoryId,
                        responsibility: b.responsibility,
                        roleTags: b.roleTags,
                        accessScope: b.accessScope,
                        isDefault: b.isDefault,
                        override: b.override,
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="解绑后智能体不能再在该仓库执行；进行中的任务会在检查点停止并待改派"
                    onConfirm={async () => {
                      try {
                        await unbindCollabAgent(b.id);
                        message.success("已解绑");
                        await onChanged();
                      } catch (e) {
                        message.error(formatCollabError(e));
                      }
                    }}
                  >
                    <Button size="small" type="link" danger>
                      解绑
                    </Button>
                  </Popconfirm>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        open={form != null}
        title="绑定仓库"
        onCancel={() => setForm(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        width={640}
        destroyOnClose
      >
        {form ? (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <Select
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="label"
              placeholder="选择要绑定的工作区仓库"
              value={form.repositoryId ?? undefined}
              options={repoOptions}
              onChange={(v: number) => {
                const repo = repoById.get(v);
                const owner = ownerProjectForRepository(projects, v);
                const tags = repo?.roleTags?.length ? repo.roleTags : repo ? [repo.repositoryType] : [];
                setForm({
                  ...form,
                  repositoryId: v,
                  projectId: owner?.id ?? form.projectId,
                  roleTags: form.roleTags.length ? form.roleTags : tags,
                });
              }}
            />
            <Input
              placeholder="职责，例如：订单接口与数据模型"
              value={form.responsibility}
              onChange={(e) => setForm({ ...form, responsibility: e.target.value })}
            />
            <Select
              mode="tags"
              placeholder="角色标签（frontend / backend / document …）"
              value={form.roleTags}
              onChange={(v: string[]) => setForm({ ...form, roleTags: v })}
            />
            <Space size={16} wrap>
              <Select
                style={{ width: 140 }}
                value={form.accessScope}
                options={[
                  { value: "read_write", label: "读写" },
                  { value: "read", label: "只读" },
                ]}
                onChange={(v) => setForm({ ...form, accessScope: v })}
              />
              <span>
                该仓库的默认负责智能体 <Switch size="small" checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} />
              </span>
            </Space>
            <Typography.Text strong>仓库专用配置（可选）</Typography.Text>
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder="仅对该仓库追加的智能体规则；不修改仓库自己的 AGENTS.md"
              value={form.override.agentsMd ?? ""}
              onChange={(e) =>
                setForm({ ...form, override: { ...form.override, agentsMd: e.target.value.trim() ? e.target.value : null } })
              }
            />
            <Select
              mode="tags"
              placeholder="在该仓库禁用的技能 ID"
              value={form.override.skillsDisable}
              onChange={(v: string[]) => setForm({ ...form, override: { ...form.override, skillsDisable: v } })}
            />
            <Select
              mode="tags"
              placeholder="在该仓库禁用的 MCP 服务 ID"
              value={form.override.mcpsDisable}
              onChange={(v: string[]) => setForm({ ...form, override: { ...form.override, mcpsDisable: v } })}
            />
          </Space>
        ) : null}
      </Modal>
    </>
  );
}
