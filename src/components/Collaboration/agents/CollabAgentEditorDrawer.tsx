import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useCollabAgent } from "../../../hooks/useCollabAgent";
import {
  agentStatusLabel,
  checkCollabAgent,
  duplicateCollabAgent,
  findCollabAgentTemplate,
  formatCollabError,
  isCollabTemplateOutdated,
  getCollabAgent,
  getCollabCapabilityMatrix,
  listCollabAgents,
  listCollabResources,
  probeCollabEngine,
  projectSelectOptions,
  publishCollabAgent,
  setCollabAgentStatus,
  updateCollabAgent,
} from "../../../services/collaboration";
import { listMcpServers } from "../../../services/mcp";
import { listProjects } from "../../../services/projectState";
import { loadRepositories } from "../../../services/repository";
import type { ProjectItem, Repository } from "../../../types";
import type {
  CollabAgentConfig,
  CollabAgentSummary,
  CollabCapabilityMatrix,
  CollabMcpBinding,
  CollabResource,
  CollabSkillBinding,
} from "../../../types/collaboration";
import { CollabAgentBindingsPanel } from "./CollabAgentBindingsPanel";
import { CollabAgentEffectiveConfigPanel } from "./CollabAgentEffectiveConfigPanel";
import { CollabAgentMemoryPanel } from "./CollabAgentMemoryPanel";
import { CollabAgentRevisionsPanel } from "./CollabAgentRevisionsPanel";
import { CollabAgentSkillsPanel } from "./CollabAgentSkillsPanel";
import "../collaboration.css";

interface Props {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
  onDuplicated?: (agentId: string) => void;
}

interface CheckItem {
  level: "ok" | "warning" | "blocking";
  label: string;
  detail: string;
}

function parseCheckItems(raw: unknown): CheckItem[] {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      level: i.level === "blocking" || i.level === "warning" ? i.level : "ok",
      label: typeof i.label === "string" ? i.label : "",
      detail: typeof i.detail === "string" ? i.detail : "",
    }));
}

const CHECK_TONE: Record<CheckItem["level"], string> = { ok: "success", warning: "warning", blocking: "error" };
const CHECK_LABEL: Record<CheckItem["level"], string> = { ok: "通过", warning: "降级", blocking: "阻塞" };

/**
 * 仓库智能体编辑：概览、绑定仓库、灵魂设定/工作规则、知识/记忆、技能/MCP、运行策略，
 * 以及按仓库查看实际生效配置与版本。保存草稿不影响已发布版本。
 */
export function CollabAgentEditorDrawer({ agentId, open, onClose, onDuplicated }: Props) {
  const { message } = AntApp.useApp();
  const { data, error, reload } = useCollabAgent(open ? agentId : null);
  const [draft, setDraft] = useState<CollabAgentConfig | null>(null);
  const [meta, setMeta] = useState({ name: "", description: "", defaultOwnerProjectId: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [matrix, setMatrix] = useState<CollabCapabilityMatrix>({});
  const [resources, setResources] = useState<CollabResource[]>([]);
  const [agents, setAgents] = useState<CollabAgentSummary[]>([]);
  const [mcpIds, setMcpIds] = useState<string[]>([]);
  const [tab, setTab] = useState("overview");

  const profile = data?.profile ?? null;

  useEffect(() => {
    if (!open) return;
    void listProjects().then(setProjects).catch(() => setProjects([]));
    void loadRepositories().then(setRepositories).catch(() => setRepositories([]));
    void getCollabCapabilityMatrix().then(setMatrix).catch(() => setMatrix({}));
    void listCollabResources(null).then(setResources).catch(() => setResources([]));
    void listCollabAgents(false).then(setAgents).catch(() => setAgents([]));
    void listMcpServers()
      .then((rows) => setMcpIds(rows.filter((r) => r.enabled).flatMap((r) => [r.id, r.name])))
      .catch(() => setMcpIds([]));
  }, [open]);

  useEffect(() => {
    if (!profile || dirty) return;
    setDraft(profile.draft);
    setMeta({
      name: profile.name,
      description: profile.description,
      defaultOwnerProjectId: profile.defaultOwnerProjectId ?? "",
    });
  }, [dirty, profile]);

  useEffect(() => {
    setDirty(false);
    setTab("overview");
  }, [agentId]);

  const patchDraft = (patch: Partial<CollabAgentConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const patchRun = (patch: Partial<CollabAgentConfig["runPolicy"]>) => {
    setDraft((d) => (d ? { ...d, runPolicy: { ...d.runPolicy, ...patch } } : d));
    setDirty(true);
  };

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) message.success(ok);
      await reload();
      return true;
    } catch (e) {
      message.error(formatCollabError(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    if (!profile || !draft) return false;
    const ok = await run(
      "save",
      () =>
        updateCollabAgent({
          agentId: profile.id,
          expectedRowVersion: profile.rowVersion,
          name: meta.name.trim() || profile.name,
          description: meta.description,
          defaultOwnerProjectId: meta.defaultOwnerProjectId,
          draft,
        }),
      "草稿已保存",
    );
    if (ok) setDirty(false);
    return ok;
  };

  const checkItems = useMemo(() => parseCheckItems(profile?.lastCheck), [profile?.lastCheck]);
  const engineOptions = useMemo(
    () => Object.keys(matrix).map((id) => ({ value: id, label: id })),
    [matrix],
  );
  const projectOptions = projectSelectOptions(projects, repositories);
  const otherAgents = agents.filter((a) => a.id !== profile?.id).map((a) => ({ value: a.id, label: a.name }));

  if (!open) return null;
  const status = profile ? agentStatusLabel(profile.status) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={920}
      destroyOnClose
      title={
        profile ? (
          <Space size={8} wrap>
            <span>{profile.name}</span>
            {status ? <Tag color={status.tone}>{status.label}</Tag> : null}
            <Tag>{profile.activeRevision ? `生效 v${profile.activeRevision}` : "未发布"}</Tag>
            {profile.hasUnpublishedChanges || dirty ? <Tag color="warning">有未发布修改</Tag> : null}
          </Space>
        ) : (
          "仓库智能体"
        )
      }
      extra={
        profile ? (
          <Space size={6} wrap>
            <Button size="small" disabled={!dirty} loading={busy === "save"} onClick={() => void saveDraft()}>
              保存草稿
            </Button>
            <Button
              size="small"
              loading={busy === "check"}
              onClick={() =>
                void (async () => {
                  if (dirty && !(await saveDraft())) return;
                  await run(
                    "check",
                    async () => {
                      const r = await checkCollabAgent(profile.id, mcpIds.length ? mcpIds : null);
                      if (!r.passed) throw { code: "INVALID_STATE", message: "检查未通过，请查看概览中的阻塞项" };
                    },
                    "检查通过",
                  );
                  setTab("overview");
                })()
              }
            >
              检查配置
            </Button>
            <Popconfirm
              title="发布新版本"
              description="发布后只影响后续新需求；运行中的需求继续使用原版本。"
              onConfirm={() =>
                void (async () => {
                  if (dirty && !(await saveDraft())) return;
                  await run(
                    "publish",
                    async () => {
                      const fresh = await getCollabAgent(profile.id);
                      await publishCollabAgent(profile.id, fresh.profile.rowVersion);
                    },
                    "已发布新版本",
                  );
                })()
              }
            >
              <Button size="small" type="primary" loading={busy === "publish"}>
                发布版本
              </Button>
            </Popconfirm>
            {profile.status === "enabled" ? (
              <Popconfirm
                title="停用后拒绝新派发，执行中的任务在检查点停止"
                onConfirm={() =>
                  void run("status", () => setCollabAgentStatus(profile.id, "disable", profile.rowVersion), "已停用")
                }
              >
                <Button size="small" danger loading={busy === "status"}>
                  停用
                </Button>
              </Popconfirm>
            ) : profile.status !== "archived" ? (
              <Button
                size="small"
                loading={busy === "status"}
                onClick={() =>
                  void run("status", () => setCollabAgentStatus(profile.id, "enable", profile.rowVersion), "已启用")
                }
              >
                启用
              </Button>
            ) : null}
            <Button
              size="small"
              loading={busy === "dup"}
              onClick={() =>
                void run("dup", async () => {
                  const copy = await duplicateCollabAgent(profile.id, `${profile.name} 副本`);
                  onDuplicated?.(copy.id);
                }, "已复制为新草稿")
              }
            >
              复制
            </Button>
            {profile.status !== "enabled" && profile.status !== "archived" ? (
              <Popconfirm
                title="归档后不再出现在接收者中；历史需求仍显示原身份"
                onConfirm={() =>
                  void run("status", () => setCollabAgentStatus(profile.id, "archive", profile.rowVersion), "已归档")
                }
              >
                <Button size="small">归档</Button>
              </Popconfirm>
            ) : null}
          </Space>
        ) : null
      }
    >
      {error ? <Alert type="error" showIcon message={formatCollabError(error)} style={{ marginBottom: 12 }} /> : null}
      {!profile || !draft ? (
        <Empty description="加载中…" />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "overview",
              label: "概览",
              children: (
                <Form layout="vertical" size="small">
                  {isCollabTemplateOutdated(draft) ? (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={`创建时使用的模板「${findCollabAgentTemplate(draft.templateId)?.label ?? draft.templateId}」已更新`}
                      description="已有智能体不会被自动覆盖；如需采纳，请在灵魂设定 / 工作规则中手动对照修改。"
                    />
                  ) : null}
                  <Form.Item label="名称" required>
                    <Input
                      value={meta.name}
                      maxLength={60}
                      onChange={(e) => {
                        setMeta((m) => ({ ...m, name: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="职责说明">
                    <Input.TextArea
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      value={meta.description}
                      onChange={(e) => {
                        setMeta((m) => ({ ...m, description: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </Form.Item>
                  <Space size={12} wrap>
                    <Form.Item label="默认主责项目">
                      <Select
                        style={{ width: 220 }}
                        allowClear
                        value={meta.defaultOwnerProjectId || undefined}
                        options={projectOptions}
                        onChange={(v?: string) => {
                          setMeta((m) => ({ ...m, defaultOwnerProjectId: v ?? "" }));
                          setDirty(true);
                        }}
                      />
                    </Form.Item>
                    <Form.Item label="执行环境">
                      <Select
                        style={{ width: 160 }}
                        value={draft.engineId}
                        options={engineOptions.length ? engineOptions : [{ value: "claude", label: "claude" }]}
                        onChange={(v: string) => patchDraft({ engineId: v })}
                      />
                    </Form.Item>
                    <Form.Item label="模型（留空跟随默认）">
                      <Input
                        style={{ width: 200 }}
                        value={draft.model ?? ""}
                        onChange={(e) => patchDraft({ model: e.target.value.trim() ? e.target.value : null })}
                      />
                    </Form.Item>
                  </Space>
                  <div className="collab-section-title">
                    检查结果
                    <Button size="small" type="link" onClick={() => void run("probe", () => probeCollabEngine(), "已重新探测执行环境能力")}>
                      重新探测引擎能力
                    </Button>
                  </div>
                  {checkItems.length ? (
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      {checkItems.map((i, idx) => (
                        <div key={idx} className="collab-card__line">
                          <Tag color={CHECK_TONE[i.level]}>{CHECK_LABEL[i.level]}</Tag>
                          <Typography.Text strong>{i.label}</Typography.Text>
                          <Typography.Text type="secondary">{i.detail}</Typography.Text>
                        </div>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">尚未检查。检查不修改业务文件，也不安装或连接未配置的外部服务。</Typography.Text>
                  )}
                </Form>
              ),
            },
            {
              key: "bindings",
              label: `绑定仓库（${data?.bindings.filter((b) => b.status === "active").length ?? 0}）`,
              children: (
                <CollabAgentBindingsPanel
                  agentId={profile.id}
                  bindings={data?.bindings ?? []}
                  projects={projects}
                  repositories={repositories}
                  onChanged={reload}
                />
              ),
            },
            {
              key: "soul",
              label: "灵魂设定 / 工作规则",
              children: (
                <Form layout="vertical" size="small">
                  <Form.Item label="SOUL.md（身份、原则、沟通方式）" extra="仅属于该智能体，不写入仓库。">
                    <Input.TextArea
                      autoSize={{ minRows: 6, maxRows: 18 }}
                      value={draft.soulMd}
                      onChange={(e) => patchDraft({ soulMd: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item
                    label="智能体 AGENTS.md（工作规则）"
                    extra="与仓库原有 AGENTS.md / CLAUDE.md 同时生效，冲突时以仓库规则和接口契约为准；不会覆盖仓库文件。"
                  >
                    <Input.TextArea
                      autoSize={{ minRows: 6, maxRows: 18 }}
                      value={draft.agentsMd}
                      onChange={(e) => patchDraft({ agentsMd: e.target.value })}
                    />
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: "knowledge",
              label: "知识 / 记忆",
              children: (
                <>
                  <div className="collab-section-title">订阅知识</div>
                  <Select
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder="选择共享知识资源（在“共享知识”中维护）"
                    value={draft.knowledgeRefs.map((k) => k.resourceId)}
                    options={resources.map((r) => ({ value: r.id, label: `${r.title} · v${r.latestVersion}` }))}
                    onChange={(ids: string[]) =>
                      patchDraft({
                        knowledgeRefs: ids.map(
                          (id) =>
                            draft.knowledgeRefs.find((k) => k.resourceId === id) ?? {
                              resourceId: id,
                              pinnedVersion: null,
                              label: resources.find((r) => r.id === id)?.title ?? id,
                            },
                        ),
                      })
                    }
                  />
                  {draft.knowledgeRefs.map((k) => (
                    <div key={k.resourceId} className="collab-card__line" style={{ marginTop: 6 }}>
                      <Typography.Text>{k.label}</Typography.Text>
                      <span>固定版本</span>
                      <InputNumber
                        size="small"
                        min={1}
                        placeholder="最新"
                        value={k.pinnedVersion ?? undefined}
                        onChange={(v) =>
                          patchDraft({
                            knowledgeRefs: draft.knowledgeRefs.map((x) =>
                              x.resourceId === k.resourceId ? { ...x, pinnedVersion: typeof v === "number" ? v : null } : x,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  <div className="collab-section-title">记忆策略</div>
                  <Space size={16} wrap>
                    <span>
                      启用记忆 <Switch size="small" checked={draft.memoryPolicy.enabled} onChange={(v) => patchDraft({ memoryPolicy: { ...draft.memoryPolicy, enabled: v } })} />
                    </span>
                    <span>
                      验证通过后自动沉淀{" "}
                      <Switch
                        size="small"
                        checked={draft.memoryPolicy.autoSaveVerified}
                        onChange={(v) => patchDraft({ memoryPolicy: { ...draft.memoryPolicy, autoSaveVerified: v } })}
                      />
                    </span>
                    <span>
                      每次最多注入{" "}
                      <InputNumber
                        size="small"
                        min={0}
                        max={50}
                        value={draft.memoryPolicy.maxItems}
                        onChange={(v) => patchDraft({ memoryPolicy: { ...draft.memoryPolicy, maxItems: Number(v ?? 0) } })}
                      />{" "}
                      条
                    </span>
                  </Space>
                  <CollabAgentMemoryPanel agentId={profile.id} projects={projects} repositories={repositories} />
                </>
              ),
            },
            {
              key: "skills",
              label: "技能 / MCP",
              children: (
                <CollabAgentSkillsPanel
                  skills={draft.skillBindings}
                  mcps={draft.mcpBindings}
                  repositories={repositories}
                  onSkillsChange={(skillBindings: CollabSkillBinding[]) => patchDraft({ skillBindings })}
                  onMcpsChange={(mcpBindings: CollabMcpBinding[]) => patchDraft({ mcpBindings })}
                />
              ),
            },
            {
              key: "policy",
              label: "运行策略",
              children: (
                <Form layout="vertical" size="small">
                  <Space size={16} wrap>
                    <Form.Item label="默认输入模式">
                      <Select
                        style={{ width: 140 }}
                        value={draft.runPolicy.defaultMode}
                        options={[
                          { value: "execute", label: "执行需求" },
                          { value: "plan", label: "先规划" },
                          { value: "discuss", label: "讨论" },
                        ]}
                        onChange={(v) => patchRun({ defaultMode: v })}
                      />
                    </Form.Item>
                    <Form.Item label="单需求并发上限">
                      <InputNumber min={1} max={8} value={draft.runPolicy.maxConcurrentAttempts} onChange={(v) => patchRun({ maxConcurrentAttempts: Number(v ?? 1) })} />
                    </Form.Item>
                    <Form.Item label="每任务执行次数预算">
                      <InputNumber min={1} max={20} value={draft.runPolicy.executionAttemptBudget} onChange={(v) => patchRun({ executionAttemptBudget: Number(v ?? 1) })} />
                    </Form.Item>
                    <Form.Item label="修正轮次预算">
                      <InputNumber min={1} max={20} value={draft.runPolicy.repairRoundBudget} onChange={(v) => patchRun({ repairRoundBudget: Number(v ?? 1) })} />
                    </Form.Item>
                    <Form.Item label="需求时长预算（分钟，留空不限）">
                      <InputNumber
                        min={1}
                        value={draft.runPolicy.budgetMs ? Math.round(draft.runPolicy.budgetMs / 60000) : undefined}
                        onChange={(v) => patchRun({ budgetMs: typeof v === "number" ? v * 60000 : null })}
                      />
                    </Form.Item>
                  </Space>
                  <Space size={16} wrap>
                    <Form.Item label="配置隔离" extra="严格：执行环境无法证明隔离时阻塞执行；尽力：降级并提示。">
                      <Select
                        style={{ width: 160 }}
                        value={draft.runPolicy.isolation}
                        options={[
                          { value: "strict", label: "严格隔离" },
                          { value: "best_effort", label: "尽力隔离" },
                        ]}
                        onChange={(v) => patchRun({ isolation: v })}
                      />
                    </Form.Item>
                    <Form.Item label="验收方式">
                      <Select
                        style={{ width: 160 }}
                        value={draft.runPolicy.acceptancePolicy}
                        options={[
                          { value: "manual", label: "人工验收" },
                          { value: "machine", label: "机器证据自动验收" },
                        ]}
                        onChange={(v) => patchRun({ acceptancePolicy: v })}
                      />
                    </Form.Item>
                  </Space>
                  <Form.Item label="可委派的专业执行者" extra="委派默认一层；专业智能体只能在获准任务范围工作，不能再转派整条需求。">
                    <Select
                      mode="multiple"
                      value={draft.delegationPolicy.allowedExecutorAgentIds}
                      options={otherAgents}
                      onChange={(ids: string[]) => patchDraft({ delegationPolicy: { allowedExecutorAgentIds: ids } })}
                    />
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: "effective",
              label: "实际生效配置",
              children: (
                <CollabAgentEffectiveConfigPanel
                  agentId={profile.id}
                  bindings={(data?.bindings ?? []).filter((b) => b.status === "active")}
                  projects={projects}
                  repositories={repositories}
                  knownMcpServerIds={mcpIds}
                  activeRevision={profile.activeRevision}
                />
              ),
            },
            {
              key: "revisions",
              label: `版本（${profile.revisions.length}）`,
              children: (
                <CollabAgentRevisionsPanel
                  profile={profile}
                  onRolledBack={() => {
                    setDirty(false);
                    void reload();
                  }}
                />
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
