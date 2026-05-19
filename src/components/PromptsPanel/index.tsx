import {
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Col,
  Input,
  Layout,
  List,
  Modal,
  Row,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
import {
  SPLIT_PROMPT_STANDARD_VARIABLES,
  type SplitPromptTemplateLayers,
} from "../../types/splitPromptLayers";
import {
  clearProjectSplitPromptLayers,
  clearRepositorySplitPromptLayers,
  loadProjectSplitPromptLayers,
  loadRepositorySplitPromptLayers,
  saveProjectSplitPromptLayers,
  saveRepositorySplitPromptLayers,
} from "../../services/splitPromptLayersStore";
import {
  allocatePromptSlotId,
  collectPromptSlotIds,
  isBuiltinPromptSlot,
  parsePromptStorageRaw,
  PROMPT_SLOT_PRD_TASK_SPLIT,
  serializePromptBundle,
  slotPromptPurposeLabel,
} from "../../services/splitPromptBundle";
import {
  resolveMergedSplitPromptLayers,
  splitPromptLayersDraftFromPartial,
} from "../../services/resolveSplitPromptLayers";
import {
  combinedMarkdownToSplitPromptBodies,
  splitPromptLayersToCombinedMarkdown,
  SPLIT_PROMPT_COMBINED_HEADINGS,
} from "../../services/splitPromptCombinedMarkdown";
import { PromptMilkdownField } from "../PromptMilkdownField";
import "./index.css";

const EMPTY_PROJECT_LIST: ProjectItem[] = [];
const EMPTY_REPOSITORY_LIST: Repository[] = [];

/** 从侧边栏「提示词」进入时传入，用于列表尚未从 DB 返回前的展示与默认选中 */
export interface PromptsOpenContext {
  project: ProjectItem;
  repository?: Repository;
}

interface Props {
  /** 工作台内由侧栏「返回」退出，不传则不展示关闭按钮。 */
  onClose?: () => void;
  projects?: ProjectItem[] | null;
  repositories?: Repository[] | null;
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  openContext?: PromptsOpenContext | null;
  repositoryListLoading?: boolean;
}

type Scope =
  | { kind: "project"; projectId: string }
  | { kind: "repository"; projectId: string; repositoryId: number };

function initialTreeSelection(
  projects: ProjectItem[] | undefined,
  activeProjectId: string | null,
  activeRepositoryId: number | null,
  openContext?: PromptsOpenContext | null,
): string[] {
  if (openContext?.repository) return [`r:${openContext.repository.id}`];
  if (openContext?.project) return [`p:${openContext.project.id}`];
  const list = projects ?? [];
  if (activeRepositoryId != null) {
    const proj = list.find((p) => p.repositoryIds.includes(activeRepositoryId));
    if (proj) return [`r:${activeRepositoryId}`];
  }
  if (activeProjectId) {
    const exists = list.some((p) => p.id === activeProjectId);
    if (exists) return [`p:${activeProjectId}`];
  }
  const first = list[0];
  if (!first) return [];
  const rid = first.repositoryIds[0];
  if (rid != null) return [`r:${rid}`];
  return [`p:${first.id}`];
}

function scopeFromTreeKey(
  key: string,
  projects: ProjectItem[] | undefined,
  repositories: Repository[] | undefined,
): Scope | null {
  const plist = projects ?? [];
  const rlist = repositories ?? [];
  if (key.startsWith("p:")) {
    const projectId = key.slice(2);
    if (!plist.some((p) => p.id === projectId)) return null;
    return { kind: "project", projectId };
  }
  if (key.startsWith("r:")) {
    const repositoryId = Number(key.slice(2));
    if (!Number.isFinite(repositoryId)) return null;
    const repo = rlist.find((r) => r.id === repositoryId);
    if (!repo) return null;
    const project = plist.find((p) => p.repositoryIds.includes(repositoryId));
    if (!project) return null;
    return { kind: "repository", projectId: project.id, repositoryId };
  }
  return null;
}

function scopeStorageKey(scope: Scope): string {
  return scope.kind === "project" ? `p:${scope.projectId}` : `r:${scope.repositoryId}`;
}

export function PromptsPanel({
  onClose,
  projects,
  repositories,
  activeProjectId,
  activeRepositoryId,
  openContext = null,
  repositoryListLoading = false,
}: Props) {
  const { message } = AntdApp.useApp();
  const projectList = useMemo(() => {
    const fromDb = projects ?? EMPTY_PROJECT_LIST;
    if (fromDb.length > 0) return fromDb;
    if (openContext?.project) return [openContext.project];
    return EMPTY_PROJECT_LIST;
  }, [projects, openContext]);

  const repositoryList = useMemo(() => {
    const fromDb = repositories ?? EMPTY_REPOSITORY_LIST;
    const seed = openContext?.repository;
    if (!seed) return fromDb;
    if (fromDb.some((r) => r.id === seed.id)) return fromDb;
    return [...fromDb, seed];
  }, [repositories, openContext]);

  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    initialTreeSelection(
      projects ?? (openContext?.project ? [openContext.project] : undefined),
      activeProjectId,
      activeRepositoryId,
      openContext,
    ),
  );
  const [loading, setLoading] = useState(false);
  const [activeSlotId, setActiveSlotId] = useState<string>(PROMPT_SLOT_PRD_TASK_SPLIT);
  const [bundleLayers, setBundleLayers] = useState<Record<string, SplitPromptTemplateLayers>>({});
  const [draft, setDraft] = useState<SplitPromptTemplateLayers>(() =>
    splitPromptLayersDraftFromPartial(null),
  );
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [newSlotName, setNewSlotName] = useState("");

  const treeSelectData = useMemo(() => {
    const byId = new Map(repositoryList.map((r) => [r.id, r]));
    return projectList.map((p) => ({
      value: `p:${p.id}`,
      title: p.name,
      selectable: true,
      children: p.repositoryIds
        .map((id) => byId.get(id))
        .filter((r): r is Repository => Boolean(r))
        .map((r) => ({
          value: `r:${r.id}`,
          title: r.name,
          selectable: true,
        })),
    }));
  }, [projectList, repositoryList]);

  const scope = useMemo(() => {
    const key = selectedKeys[0];
    if (typeof key !== "string") return null;
    return scopeFromTreeKey(key, projectList, repositoryList);
  }, [selectedKeys, projectList, repositoryList]);

  const loadScope = useCallback(async () => {
    if (!scope) {
      setBundleLayers({});
      setDraft(splitPromptLayersDraftFromPartial(null));
      setActiveSlotId(PROMPT_SLOT_PRD_TASK_SPLIT);
      return;
    }
    setLoading(true);
    try {
      const raw =
        scope.kind === "project"
          ? await loadProjectSplitPromptLayers(scope.projectId)
          : await loadRepositorySplitPromptLayers(scope.repositoryId);
      const map = parsePromptStorageRaw(raw);
      const ids = collectPromptSlotIds(map);
      const projectId = scope.projectId;
      const repositoryId = scope.kind === "repository" ? scope.repositoryId : null;
      const full: Record<string, SplitPromptTemplateLayers> = {};
      for (const id of ids) {
        if (map[id]) {
          full[id] = splitPromptLayersDraftFromPartial(map[id]);
        } else if (isBuiltinPromptSlot(id)) {
          full[id] = await resolveMergedSplitPromptLayers(projectId, repositoryId, id);
        } else {
          full[id] = splitPromptLayersDraftFromPartial(null);
        }
      }
      setBundleLayers(full);
      setActiveSlotId(PROMPT_SLOT_PRD_TASK_SPLIT);
      setDraft(
        full[PROMPT_SLOT_PRD_TASK_SPLIT] ??
          (await resolveMergedSplitPromptLayers(projectId, repositoryId, PROMPT_SLOT_PRD_TASK_SPLIT)),
      );
    } catch (e) {
      console.error(e);
      message.error("加载提示词失败");
    } finally {
      setLoading(false);
    }
  }, [scope, message]);

  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  useEffect(() => {
    if (selectedKeys.length > 0) return;
    const next = initialTreeSelection(
      projectList,
      activeProjectId,
      activeRepositoryId,
      openContext,
    );
    if (next.length > 0) setSelectedKeys(next);
  }, [projectList, activeProjectId, activeRepositoryId, openContext, selectedKeys.length]);

  const slotIdList = useMemo(() => collectPromptSlotIds(bundleLayers), [bundleLayers]);

  const milkdownScopeKey = scope ? scopeStorageKey(scope) : "none";
  const selectedProject = useMemo(() => {
    if (!scope) return null;
    return projectList.find((project) => project.id === scope.projectId) ?? null;
  }, [projectList, scope]);
  const selectedRepository = useMemo(() => {
    if (!scope || scope.kind !== "repository") return null;
    return repositoryList.find((repository) => repository.id === scope.repositoryId) ?? null;
  }, [repositoryList, scope]);
  const enabledSlotCount = useMemo(
    () => slotIdList.filter((slotId) => {
      const layers = slotId === activeSlotId ? draft : bundleLayers[slotId];
      return layers?.enabled ?? true;
    }).length,
    [activeSlotId, bundleLayers, draft, slotIdList],
  );
  const scopeLabel = scope
    ? scope.kind === "repository"
      ? selectedRepository?.name ?? `仓库 #${scope.repositoryId}`
      : selectedProject?.name ?? "项目"
    : "未选择";
  const scopeTypeLabel = scope?.kind === "repository" ? "仓库覆盖" : scope?.kind === "project" ? "项目默认" : "未选择";

  function purposeLabelForSlot(slotId: string): string {
    const partial = slotId === activeSlotId ? draft : bundleLayers[slotId];
    return slotPromptPurposeLabel(slotId, partial);
  }

  function handleSlotChange(next: string) {
    if (!scope || next === activeSlotId) return;
    const merged = { ...bundleLayers, [activeSlotId]: draft };
    setBundleLayers(merged);
    setActiveSlotId(next);
    setDraft(merged[next] ?? splitPromptLayersDraftFromPartial(null));
  }

  function handleDeleteSlot(slotId: string) {
    if (isBuiltinPromptSlot(slotId)) {
      message.warning("内置用途不可删除");
      return;
    }
    Modal.confirm({
      title: `删除用途「${purposeLabelForSlot(slotId)}」？`,
      content: "仅从当前草稿中移除；需点击「保存」后才会写入磁盘。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const flushed = { ...bundleLayers, [activeSlotId]: draft };
        if (!(slotId in flushed)) return;
        const { [slotId]: _removed, ...rest } = flushed;
        let nextRest = rest;
        if (Object.keys(nextRest).length === 0 && scope) {
          const projectId = scope.projectId;
          const repositoryId = scope.kind === "repository" ? scope.repositoryId : null;
          const layers = await resolveMergedSplitPromptLayers(
            projectId,
            repositoryId,
            PROMPT_SLOT_PRD_TASK_SPLIT,
          );
          nextRest = { [PROMPT_SLOT_PRD_TASK_SPLIT]: layers };
        }
        setBundleLayers(nextRest);
        if (activeSlotId === slotId) {
          const fallback =
            nextRest[PROMPT_SLOT_PRD_TASK_SPLIT] !== undefined
              ? PROMPT_SLOT_PRD_TASK_SPLIT
              : (Object.keys(nextRest)[0] ?? PROMPT_SLOT_PRD_TASK_SPLIT);
          setActiveSlotId(fallback);
          const nextDraft = nextRest[fallback];
          if (nextDraft) {
            setDraft(nextDraft);
          } else if (scope && isBuiltinPromptSlot(fallback)) {
            setDraft(
              await resolveMergedSplitPromptLayers(
                scope.projectId,
                scope.kind === "repository" ? scope.repositoryId : null,
                fallback,
              ),
            );
          } else {
            setDraft(splitPromptLayersDraftFromPartial(null));
          }
        } else {
          setDraft(flushed[activeSlotId]!);
        }
      },
    });
  }

  function handleOpenAddSlot() {
    setNewSlotName("");
    setAddSlotOpen(true);
  }

  function handleConfirmAddSlot() {
    const name = newSlotName.trim();
    if (!name) {
      message.warning("请输入用途名称");
      return;
    }
    const mergedFlush = { ...bundleLayers, [activeSlotId]: draft };
    const id = allocatePromptSlotId(Object.keys(mergedFlush));
    const nextLayers = {
      ...mergedFlush,
      [id]: splitPromptLayersDraftFromPartial({
        templateId: id,
        version: "1.0.0",
        enabled: true,
        systemBody: `## ${name}\n\n`,
      }),
    };
    setBundleLayers(nextLayers);
    setActiveSlotId(id);
    setDraft(nextLayers[id]!);
    setAddSlotOpen(false);
    message.success("已添加用途，编辑后请保存");
  }

  async function handleSave() {
    if (!scope) return;
    try {
      const merged = { ...bundleLayers, [activeSlotId]: draft };
      const json = serializePromptBundle(merged);
      if (scope.kind === "project") {
        await saveProjectSplitPromptLayers(scope.projectId, json);
      } else {
        await saveRepositorySplitPromptLayers(scope.repositoryId, json);
      }
      message.success("已保存");
      await loadScope();
    } catch (e) {
      console.error(e);
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function handleClear() {
    if (!scope) return;
    Modal.confirm({
      title: "清除此作用域的全部提示词用途？",
      content: "将删除本层已保存的所有用途配置（含 PRD 任务拆分等），并回退为上层默认。",
      okText: "清除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (scope.kind === "project") {
            await clearProjectSplitPromptLayers(scope.projectId);
          } else {
            await clearRepositorySplitPromptLayers(scope.repositoryId);
          }
          message.success("已清除");
          await loadScope();
        } catch (e) {
          console.error(e);
          message.error("清除失败");
        }
      },
    });
  }

  const showLoadingShell = repositoryListLoading && projectList.length === 0;
  const showEmptyHint = !repositoryListLoading && projectList.length === 0;

  const selectedScopeValue = selectedKeys[0];

  return (
    <Layout.Content className="app-prd-task-panel app-prompts-panel--compact">
      <Space orientation="vertical" size={8} className="app-prd-task-panel__stack">
        <div className="app-prompts-panel__scope-bar" aria-label="当前提示词作用域">
          <div className="app-prompts-panel__scope-bar-chips">
            <span>{scopeLabel}</span>
            <span>{scopeTypeLabel}</span>
            <span>{enabledSlotCount}/{slotIdList.length} 启用</span>
          </div>
          {onClose ? (
            <Tooltip title="关闭" mouseEnterDelay={0.35}>
              <Button
                type="text"
                size="small"
                className="app-prompts-panel__close-btn"
                icon={<CloseOutlined />}
                onClick={onClose}
                aria-label="关闭"
              />
            </Tooltip>
          ) : null}
        </div>

        {showLoadingShell ? (
          <div className="app-prompts-panel__placeholder">
            <Spin size="small" description="正在加载项目与仓库…" />
          </div>
        ) : showEmptyHint ? (
          <div className="app-prompts-panel__placeholder">
            <Typography.Text type="secondary">请先创建项目并关联仓库</Typography.Text>
          </div>
        ) : (
          <Row gutter={12} className="app-prd-task-panel__columns app-prompts-panel__row">
            <Col xs={24} className="app-prd-task-panel__col app-prompts-panel__main-col">
              <Spin spinning={loading}>
                <div className="app-prompts-panel__main-card">
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    <div className="app-prompts-panel__card-toolbar">
                      <div className="app-prompts-panel__card-toolbar-tree">
                        <TreeSelect
                          className="app-prompts-panel__scope-tree-select"
                          size="small"
                          treeLine
                          showSearch
                          treeNodeFilterProp="title"
                          allowClear={false}
                          treeDefaultExpandAll
                          placeholder="选择项目 / 仓库"
                          value={typeof selectedScopeValue === "string" ? selectedScopeValue : undefined}
                          treeData={treeSelectData}
                          popupMatchSelectWidth={false}
                          listHeight={320}
                          onChange={(v) => {
                            if (v) setSelectedKeys([String(v)]);
                          }}
                        />
                      </div>
                      <div className="app-prompts-panel__card-toolbar-actions">
                        {scope ? (
                          <Space size={4} wrap>
                            <Button size="small" onClick={handleClear}>
                              清除
                            </Button>
                            <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>
                              保存
                            </Button>
                          </Space>
                        ) : null}
                      </div>
                    </div>
                    {scope ? (
                      <Space
                        orientation="vertical"
                        size={8}
                        style={{ width: "100%" }}
                        className="app-prompts-panel__body-stack"
                      >
                        <div className="app-prompts-panel__contract">
                          <Typography.Text strong>提示词契约</Typography.Text>
                          <Typography.Text type="secondary">
                            用途决定调用位置；项目默认会被仓库同名用途覆盖。正文直接编辑；
                            可用「{SPLIT_PROMPT_COMBINED_HEADINGS.system}」等独占一行标题分层落盘，无标题则写入用户模板层。
                          </Typography.Text>
                        </div>

                        <Row gutter={12} className="app-prompts-panel__editor-row">
                          <Col xs={24} md={5} lg={5} xl={5} className="app-prompts-panel__slot-col">
                            <section className="app-prompts-panel__slot-list-card" aria-label="提示词用途">
                              <div className="app-prompts-panel__slot-list-head">
                                <Typography.Text strong>调用用途</Typography.Text>
                                <Typography.Text type="secondary">{slotIdList.length} 个</Typography.Text>
                              </div>
                              <Button
                                type="dashed"
                                block
                                size="small"
                                icon={<PlusOutlined />}
                                style={{ marginBottom: 6 }}
                                onClick={handleOpenAddSlot}
                              >
                                新建用途
                              </Button>
                              <List
                                size="small"
                                bordered
                                dataSource={slotIdList}
                                locale={{ emptyText: "暂无用途" }}
                                className="app-prompts-panel__slot-list"
                                renderItem={(slotId) => {
                                  const active = slotId === activeSlotId;
                                  const deletable = !isBuiltinPromptSlot(slotId);
                                  return (
                                    <List.Item
                                      className={
                                        active
                                          ? "app-prompts-panel__slot-item app-prompts-panel__slot-item--active"
                                          : "app-prompts-panel__slot-item"
                                      }
                                      onClick={() => handleSlotChange(slotId)}
                                      actions={
                                        deletable
                                          ? [
                                              <Button
                                                key="del"
                                                type="text"
                                                danger
                                                size="small"
                                                icon={<DeleteOutlined />}
                                                aria-label={`删除用途 ${slotId}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDeleteSlot(slotId);
                                                }}
                                              />,
                                            ]
                                          : []
                                      }
                                    >
                                      <List.Item.Meta
                                        title={
                                          <Typography.Text ellipsis strong={active}>
                                            {purposeLabelForSlot(slotId)}
                                          </Typography.Text>
                                        }
                                        description={
                                          <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                                            {slotId}
                                          </Typography.Text>
                                        }
                                      />
                                    </List.Item>
                                  );
                                }}
                              />
                            </section>
                          </Col>
                          <Col xs={24} md={19} lg={19} xl={19} className="app-prompts-panel__editor-col">
                            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                              <Space align="center" wrap size={4}>
                                <Typography.Text className="app-prompts-panel__inline-label">本层</Typography.Text>
                                <Switch
                                  checked={draft.enabled}
                                  onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
                                />
                                {!draft.enabled && (
                                  <Typography.Text type="secondary" className="app-prompts-panel__hint-inline">
                                    关闭则回退平台默认
                                  </Typography.Text>
                                )}
                              </Space>
                              <Space wrap size={[4, 4]}>
                                <Typography.Text type="secondary" className="app-prompts-panel__inline-label">
                                  占位符
                                </Typography.Text>
                                {SPLIT_PROMPT_STANDARD_VARIABLES.map((v) => (
                                  <Tag key={v} variant="filled" className="app-prompts-panel__ph-tag">
                                    {`{${v}}`}
                                  </Tag>
                                ))}
                              </Space>
                              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                                <Typography.Text strong className="app-prompts-panel__section-label">
                                  模板编号 / 版本
                                </Typography.Text>
                                <Space wrap size={6} style={{ width: "100%" }}>
                                  <Input
                                    size="small"
                                    style={{ minWidth: 160, flex: 1, maxWidth: 280 }}
                                    placeholder="templateId"
                                    value={draft.templateId}
                                    onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}
                                  />
                                  <Input
                                    size="small"
                                    style={{ width: 88 }}
                                    placeholder="version"
                                    value={draft.version}
                                    onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
                                  />
                                </Space>
                              </Space>

                              <div className="app-prompts-panel__combined-editor">
                                <PromptMilkdownField
                                  instanceKey={`${milkdownScopeKey}-${activeSlotId}-combined`}
                                  label="提示词正文"
                                  hint={`须含 {PRD_MARKDOWN} 等占位符（用户模板段）；可选章节标题：${SPLIT_PROMPT_COMBINED_HEADINGS.system} / ${SPLIT_PROMPT_COMBINED_HEADINGS.strategy} / ${SPLIT_PROMPT_COMBINED_HEADINGS.user}（独占一行）`}
                                  value={splitPromptLayersToCombinedMarkdown(draft)}
                                  onChange={(md) =>
                                    setDraft((d) => ({ ...d, ...combinedMarkdownToSplitPromptBodies(md) }))
                                  }
                                />
                              </div>
                            </Space>
                          </Col>
                        </Row>
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">请在下拉中选择项目或仓库。</Typography.Text>
                    )}
                  </Space>
                </div>
              </Spin>
            </Col>
          </Row>
        )}
      </Space>

      <Modal
        title="新建提示词用途"
        open={addSlotOpen}
        onOk={handleConfirmAddSlot}
        onCancel={() => setAddSlotOpen(false)}
        okText="添加"
        destroyOnHidden
      >
        <Space orientation="vertical" style={{ width: "100%" }} size="small">
          <Typography.Paragraph type="secondary" className="app-prompts-panel__modal-hint">
            名称将写入「{SPLIT_PROMPT_COMBINED_HEADINGS.system}」一节开头的 <code>## 标题</code>
            ；用途 id 由系统随机生成（p + 32 位十六进制）。
          </Typography.Paragraph>
          <Input
            size="small"
            placeholder="用途名称，如 发版说明"
            value={newSlotName}
            onChange={(e) => setNewSlotName(e.target.value)}
            onPressEnter={handleConfirmAddSlot}
          />
        </Space>
      </Modal>
    </Layout.Content>
  );
}
