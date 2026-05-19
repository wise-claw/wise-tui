import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Select,
  Segmented,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  buildAssistantEngineeringJson,
  buildAssistantRuntimeBundleJson,
  parseAssistantEngineeringPreferences,
  parseAssistantRuntimeBundle,
  resetAssistantRuntimeOverrides,
  resolveAssistantRuntime,
  saveAssistantRuntimeOverrides,
  type AssistantBundleItem,
  type AssistantEngineeringPreferences,
  type AssistantRuntimeBundle,
} from "../../services/assistantPromptLayers";
import {
  detectExternalSkillPaths,
  scanSkillPath,
  type DetectedExternalPath,
} from "../../services/skills";
import type { AssistantBundleRef, AssistantEntry } from "../../types/assistant";
import {
  addSkillMount,
  filterSkillMountCandidates,
  removeSkillMount,
  scannedSkillToMountCandidate,
  type SkillMountCandidate,
} from "./assistantSkillMount";

type SettingsScope = "assistant" | "project";
type CheckboxSelectionValue = string | number | boolean;

export interface AssistantSettingsDrawerProps {
  open: boolean;
  assistant: AssistantEntry | null;
  activeProjectId: string | null;
  activeProjectName: string | null;
  onClose: () => void;
}

interface SettingsDraft {
  skills: AssistantRuntimeBundle;
  mcps: AssistantRuntimeBundle;
  engineering: AssistantEngineeringPreferences;
}

const EMPTY_DRAFT: SettingsDraft = {
  skills: { disabled: [], custom: [] },
  mcps: { disabled: [], custom: [] },
  engineering: {},
};

/**
 * 助手 Hub 的轻量设置抽屉。它先打通真实持久化链路:
 * builtin bundle 可启停,项目作用域可覆盖,自定义格式偏好可保存。
 */
export function AssistantSettingsDrawer({
  open,
  assistant,
  activeProjectId,
  activeProjectName,
  onClose,
}: AssistantSettingsDrawerProps) {
  const { message } = AntdApp.useApp();
  const [scope, setScope] = useState<SettingsScope>("assistant");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skillPoolLoading, setSkillPoolLoading] = useState(false);
  const [skillScanLoading, setSkillScanLoading] = useState(false);
  const [skillPaths, setSkillPaths] = useState<DetectedExternalPath[]>([]);
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<SkillMountCandidate[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);

  const effectiveScope = scope === "project" && activeProjectId
    ? `project:${activeProjectId}`
    : "assistant";

  useEffect(() => {
    if (!open) return;
    setScope("assistant");
    setSkillQuery("");
  }, [open, assistant?.id]);

  useEffect(() => {
    if (!open || !assistant) return;
    let cancelled = false;
    setLoading(true);
    resolveAssistantRuntime({
      assistantId: assistant.id,
      projectId: scope === "project" ? activeProjectId : null,
    })
      .then((runtime) => {
        if (cancelled) return;
        setDraft({
          skills: parseAssistantRuntimeBundle(runtime.skillBundleJson),
          mcps: parseAssistantRuntimeBundle(runtime.mcpBundleJson),
          engineering: parseAssistantEngineeringPreferences(runtime.engineeringJson),
        });
      })
      .catch((err) => {
        if (!cancelled) {
          message.error(`读取助手设置失败：${err instanceof Error ? err.message : String(err)}`);
          setDraft(EMPTY_DRAFT);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, assistant, message, open, scope]);

  useEffect(() => {
    if (!open || !assistant) return;
    let cancelled = false;
    setSkillPoolLoading(true);
    detectExternalSkillPaths()
      .then((paths) => {
        if (cancelled) return;
        const existing = paths.filter((path) => path.exists && path.count > 0);
        setSkillPaths(existing);
        setSelectedSkillPath((current) =>
          current && existing.some((path) => path.path === current)
            ? current
            : existing[0]?.path ?? null,
        );
      })
      .catch((err) => {
        if (!cancelled) {
          message.error(`读取技能目录失败：${err instanceof Error ? err.message : String(err)}`);
          setSkillPaths([]);
          setSelectedSkillPath(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSkillPoolLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assistant, message, open]);

  useEffect(() => {
    if (!open || !selectedSkillPath) {
      setSkillCandidates([]);
      return;
    }
    let cancelled = false;
    setSkillScanLoading(true);
    scanSkillPath(selectedSkillPath)
      .then((skills) => {
        if (cancelled) return;
        setSkillCandidates(skills.filter((skill) => skill.hasSkillMd).map(scannedSkillToMountCandidate));
      })
      .catch((err) => {
        if (!cancelled) {
          message.error(`扫描技能目录失败：${err instanceof Error ? err.message : String(err)}`);
          setSkillCandidates([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSkillScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message, open, selectedSkillPath]);

  const skillOptions = useMemo(
    () => toBundleItems(assistant?.defaultSkills ?? [], draft.skills.custom),
    [assistant?.defaultSkills, draft.skills.custom],
  );
  const mcpOptions = useMemo(
    () => toBundleItems(assistant?.defaultMcps ?? [], draft.mcps.custom),
    [assistant?.defaultMcps, draft.mcps.custom],
  );

  const handleSave = useCallback(async () => {
    if (!assistant) return;
    setSaving(true);
    try {
      await saveAssistantRuntimeOverrides({
        assistantId: assistant.id,
        scope: effectiveScope,
        patch: {
          skillBundleJson: buildAssistantRuntimeBundleJson(draft.skills),
          mcpBundleJson: buildAssistantRuntimeBundleJson(draft.mcps),
          engineeringJson: buildAssistantEngineeringJson(draft.engineering),
        },
      });
      message.success("助手设置已保存。");
    } catch (err) {
      message.error(`保存助手设置失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [assistant, draft.engineering, draft.mcps, draft.skills, effectiveScope, message]);

  const handleReset = useCallback(async () => {
    if (!assistant) return;
    setSaving(true);
    try {
      await resetAssistantRuntimeOverrides({
        assistantId: assistant.id,
        scope: effectiveScope,
        sections: ["skills", "mcps", "engineering"],
      });
      const runtime = await resolveAssistantRuntime({
        assistantId: assistant.id,
        projectId: scope === "project" ? activeProjectId : null,
      });
      setDraft({
        skills: parseAssistantRuntimeBundle(runtime.skillBundleJson),
        mcps: parseAssistantRuntimeBundle(runtime.mcpBundleJson),
        engineering: parseAssistantEngineeringPreferences(runtime.engineeringJson),
      });
      message.success("已重置当前作用域设置。");
    } catch (err) {
      message.error(`重置助手设置失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, assistant, effectiveScope, message, scope]);

  const handleSkillSelection = useCallback((selectedIds: CheckboxSelectionValue[]) => {
    const selected = new Set(selectedIds.map(String));
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        disabled: skillOptions.filter((item) => !selected.has(item.id)).map((item) => item.id),
        custom: prev.skills.custom,
      },
    }));
  }, [skillOptions]);

  const handleMcpSelection = useCallback((selectedIds: CheckboxSelectionValue[]) => {
    const selected = new Set(selectedIds.map(String));
    setDraft((prev) => ({
      ...prev,
      mcps: {
        ...prev.mcps,
        disabled: mcpOptions.filter((item) => !selected.has(item.id)).map((item) => item.id),
        custom: prev.mcps.custom,
      },
    }));
  }, [mcpOptions]);

  const selectedSkills = skillOptions
    .filter((item) => !draft.skills.disabled.includes(item.id))
    .map((item) => item.id);
  const selectedMcps = mcpOptions
    .filter((item) => !draft.mcps.disabled.includes(item.id))
    .map((item) => item.id);
  const filteredSkillCandidates = useMemo(
    () => filterSkillMountCandidates(skillCandidates, skillQuery),
    [skillCandidates, skillQuery],
  );

  const handleMountSkill = useCallback((candidate: SkillMountCandidate) => {
    setDraft((prev) => ({
      ...prev,
      skills: addSkillMount(prev.skills, candidate),
    }));
  }, []);

  const handleRemoveMountedSkill = useCallback((skillId: string) => {
    setDraft((prev) => ({
      ...prev,
      skills: removeSkillMount(prev.skills, skillId),
    }));
  }, []);

  return (
    <Drawer
      title={assistant ? `${assistant.name} 设置` : "助手设置"}
      open={open}
      onClose={onClose}
      width={520}
      className="assistant-settings-drawer"
      extra={
        <div className="assistant-settings-drawer__actions">
          <Button size="small" onClick={handleReset} loading={saving} disabled={!assistant}>
            重置
          </Button>
          <Button size="small" type="primary" onClick={handleSave} loading={saving} disabled={!assistant}>
            保存
          </Button>
        </div>
      }
    >
      {!assistant ? (
        <Empty description="未选择助手" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="assistant-settings-drawer__content">
          <div className="assistant-settings-drawer__summary">
            <span
              className="assistant-settings-drawer__avatar"
              style={{ background: assistant.avatarColor ?? "#1677FF" }}
              aria-hidden
            >
              {assistant.name.slice(0, 1)}
            </span>
            <div className="assistant-settings-drawer__meta">
              <Typography.Text strong>{assistant.name}</Typography.Text>
              <Typography.Text type="secondary">{assistant.description || "暂无描述"}</Typography.Text>
              <div className="assistant-settings-drawer__tags">
                <Tag>{sourceLabel(assistant.source)}</Tag>
                <Tag>{assistant.engineId}</Tag>
                {assistant.builtIn ? <Tag color="blue">内置不可删除</Tag> : null}
              </div>
            </div>
          </div>

          <Segmented<SettingsScope>
            value={scope}
            onChange={setScope}
            options={[
              { label: "助手默认", value: "assistant" },
              {
                label: activeProjectName ? `工作区：${activeProjectName}` : "工作区覆盖",
                value: "project",
                disabled: !activeProjectId,
              },
            ]}
          />

          {loading ? (
            <div className="assistant-settings-drawer__loading">
              <Spin size="small" />
            </div>
          ) : (
            <Tabs
              size="small"
              items={[
                {
                  key: "skills",
                  label: "Skills",
                  children: (
                    <SkillSettingsPanel
                      items={skillOptions}
                      selectedIds={selectedSkills}
                      onSelectionChange={handleSkillSelection}
                      onRemoveMountedSkill={handleRemoveMountedSkill}
                      skillPaths={skillPaths}
                      selectedSkillPath={selectedSkillPath}
                      onSelectSkillPath={setSelectedSkillPath}
                      skillPoolLoading={skillPoolLoading}
                      skillScanLoading={skillScanLoading}
                      candidates={filteredSkillCandidates}
                      mountedSkillIds={new Set(skillOptions.map((item) => item.id))}
                      query={skillQuery}
                      onQueryChange={setSkillQuery}
                      onMountSkill={handleMountSkill}
                    />
                  ),
                },
                {
                  key: "mcps",
                  label: "MCP",
                  children: (
                    <BundleSelector
                      emptyText="这个助手还没有默认 MCP。后续可从 MCP 工具池挂载。"
                      items={mcpOptions}
                      selectedIds={selectedMcps}
                      onChange={handleMcpSelection}
                    />
                  ),
                },
                {
                  key: "preferences",
                  label: "偏好",
                  children: (
                    <EngineeringEditor
                      value={draft.engineering}
                      onChange={(engineering) => setDraft((prev) => ({ ...prev, engineering }))}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}

interface SkillSettingsPanelProps {
  items: AssistantBundleItem[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: CheckboxSelectionValue[]) => void;
  onRemoveMountedSkill: (skillId: string) => void;
  skillPaths: DetectedExternalPath[];
  selectedSkillPath: string | null;
  onSelectSkillPath: (path: string | null) => void;
  skillPoolLoading: boolean;
  skillScanLoading: boolean;
  candidates: SkillMountCandidate[];
  mountedSkillIds: Set<string>;
  query: string;
  onQueryChange: (query: string) => void;
  onMountSkill: (candidate: SkillMountCandidate) => void;
}

function SkillSettingsPanel({
  items,
  selectedIds,
  onSelectionChange,
  onRemoveMountedSkill,
  skillPaths,
  selectedSkillPath,
  onSelectSkillPath,
  skillPoolLoading,
  skillScanLoading,
  candidates,
  mountedSkillIds,
  query,
  onQueryChange,
  onMountSkill,
}: SkillSettingsPanelProps) {
  return (
    <div className="assistant-settings-drawer__skills">
      <BundleSelector
        emptyText="这个助手还没有内置或挂载 Skill。可从下方技能池添加。"
        items={items}
        selectedIds={selectedIds}
        onChange={onSelectionChange}
        onRemoveMountedSkill={onRemoveMountedSkill}
      />
      <div className="assistant-settings-drawer__skill-pool">
        <div className="assistant-settings-drawer__section-head">
          <Typography.Text strong>添加 Skill</Typography.Text>
          <Typography.Text type="secondary">从本机 skills 目录选择后，保存到当前作用域。</Typography.Text>
        </div>
        <Select
          size="small"
          value={selectedSkillPath ?? undefined}
          placeholder={skillPoolLoading ? "读取技能目录..." : "选择技能目录"}
          loading={skillPoolLoading}
          onChange={(value) => onSelectSkillPath(value)}
          options={skillPaths.map((path) => ({
            value: path.path,
            label: `${path.path} · ${path.count}`,
          }))}
        />
        <Input.Search
          size="small"
          allowClear
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索 skill 名称或路径"
        />
        {skillScanLoading ? (
          <div className="assistant-settings-drawer__loading assistant-settings-drawer__loading--compact">
            <Spin size="small" />
          </div>
        ) : selectedSkillPath && candidates.length > 0 ? (
          <div className="assistant-settings-drawer__candidate-list">
            {candidates.slice(0, 24).map((candidate) => {
              const mounted = mountedSkillIds.has(candidate.id);
              return (
                <div key={`${candidate.sourcePath}:${candidate.id}`} className="assistant-settings-drawer__candidate">
                  <span className="assistant-settings-drawer__bundle-copy">
                    <span className="assistant-settings-drawer__bundle-label">{candidate.label}</span>
                    <span className="assistant-settings-drawer__bundle-path">{candidate.sourcePath}</span>
                  </span>
                  <Tag>{originLabel(candidate.origin)}</Tag>
                  <Button
                    size="small"
                    type={mounted ? "default" : "primary"}
                    disabled={mounted}
                    onClick={() => onMountSkill(candidate)}
                  >
                    {mounted ? "已挂载" : "挂载"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={selectedSkillPath ? "该目录没有可挂载 Skill" : "没有可用技能目录"}
          />
        )}
      </div>
    </div>
  );
}

interface BundleSelectorProps {
  items: AssistantBundleItem[];
  selectedIds: string[];
  emptyText: string;
  onChange: (selectedIds: CheckboxSelectionValue[]) => void;
  onRemoveMountedSkill?: (skillId: string) => void;
}

function BundleSelector({ items, selectedIds, emptyText, onChange, onRemoveMountedSkill }: BundleSelectorProps) {
  if (items.length === 0) {
    return <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  return (
    <Checkbox.Group value={selectedIds} onChange={onChange} className="assistant-settings-drawer__bundle-list">
      {items.map((item) => (
        <label key={item.id} className="assistant-settings-drawer__bundle-item">
          <Checkbox value={item.id} />
          <span className="assistant-settings-drawer__bundle-copy">
            <span className="assistant-settings-drawer__bundle-label">{item.label}</span>
            <span className="assistant-settings-drawer__bundle-id">{item.id}</span>
            {item.sourcePath ? (
              <span className="assistant-settings-drawer__bundle-path">{item.sourcePath}</span>
            ) : null}
          </span>
          {item.origin ? <Tag>{originLabel(item.origin)}</Tag> : null}
          {item.origin !== "builtin" && onRemoveMountedSkill ? (
            <Button size="small" type="link" danger onClick={() => onRemoveMountedSkill(item.id)}>
              移除
            </Button>
          ) : null}
        </label>
      ))}
    </Checkbox.Group>
  );
}

interface EngineeringEditorProps {
  value: AssistantEngineeringPreferences;
  onChange: (value: AssistantEngineeringPreferences) => void;
}

function EngineeringEditor({ value, onChange }: EngineeringEditorProps) {
  return (
    <div className="assistant-settings-drawer__prefs">
      <label className="assistant-settings-drawer__pref-row">
        <span>
          <Typography.Text strong>复用已有父任务</Typography.Text>
          <Typography.Text type="secondary">适合连续拆分同一份 PRD，避免重复创建父级上下文。</Typography.Text>
        </span>
        <Switch
          size="small"
          checked={value.reuseExistingParents ?? false}
          onChange={(checked) => onChange({ ...value, reuseExistingParents: checked })}
        />
      </label>
      <label className="assistant-settings-drawer__pref-row">
        <span>
          <Typography.Text strong>只派发脏任务</Typography.Text>
          <Typography.Text type="secondary">重新落盘执行时优先跳过未变化任务。</Typography.Text>
        </span>
        <Switch
          size="small"
          checked={value.dispatchOnlyDirty ?? false}
          onChange={(checked) => onChange({ ...value, dispatchOnlyDirty: checked })}
        />
      </label>
      <label className="assistant-settings-drawer__format">
        <Typography.Text strong>格式偏好</Typography.Text>
        <Input.TextArea
          value={value.formatProfile ?? ""}
          onChange={(event) => onChange({ ...value, formatProfile: event.target.value })}
          rows={4}
          placeholder="例如：Word 默认使用公司报告模板；PPT 使用深色高对比视觉，封面保留客户 Logo 区。"
        />
      </label>
    </div>
  );
}

function toBundleItems(
  defaults: AssistantBundleRef[],
  custom: AssistantBundleItem[],
): AssistantBundleItem[] {
  const out = new Map<string, AssistantBundleItem>();
  for (const item of defaults) {
    out.set(item.id, {
      id: item.id,
      label: item.label,
      origin: "builtin",
      sourcePath: item.sourcePath,
    });
  }
  for (const item of custom) {
    out.set(item.id, item);
  }
  return [...out.values()];
}

function sourceLabel(source: AssistantEntry["source"]): string {
  switch (source) {
    case "builtin":
      return "Wise 内置";
    case "custom":
      return "自建";
    case "extension":
      return "扩展";
  }
}

function originLabel(origin: string): string {
  switch (origin) {
    case "builtin":
      return "内置";
    case "custom":
      return "自定义";
    default:
      return origin;
  }
}
