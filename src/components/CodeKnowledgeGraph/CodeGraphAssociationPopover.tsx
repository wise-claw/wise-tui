import { Button, Checkbox, Popover, Radio, Space, Tooltip, Typography } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeGraphRepositoryMenuItem } from "./CodeGraphRepositoryPopover";
import { CodeGraphAssociationIcon } from "./CodeGraphAssociationIcon";

export type AssociationGraphMode = "all" | "custom";

export interface AssociationGraphConfig {
  mode: AssociationGraphMode;
  /** `mode === "custom"` 时生效；已去重、顺序稳定 */
  customRepositoryIds: number[];
}

/** 与 `CodeKnowledgeGraphPanel` 中 `resolvedGraphRepoIds` 规则一致 */
export function resolveAssociationRepositoryIds(
  config: AssociationGraphConfig,
  candidateRepositoryIds: number[],
  activeRepositoryId: number | null,
): number[] {
  if (candidateRepositoryIds.length === 0) {
    return activeRepositoryId != null ? [activeRepositoryId] : [];
  }
  if (candidateRepositoryIds.length === 1) {
    return candidateRepositoryIds;
  }
  if (config.mode === "all") {
    return [...candidateRepositoryIds];
  }
  const picked = config.customRepositoryIds.filter((id) => candidateRepositoryIds.includes(id));
  if (picked.length === 0 && activeRepositoryId != null) {
    return [activeRepositoryId];
  }
  return [...new Set(picked)].slice(0, 20);
}

interface Props {
  repositories: CodeGraphRepositoryMenuItem[];
  candidateRepositoryIds: number[];
  activeRepositoryId: number | null;
  value: AssociationGraphConfig;
  onChange: (next: AssociationGraphConfig) => void;
  /** 每次「同步仓库组」后触发；参数为解析后的参与仓库 id（与画布子图范围一致） */
  onApplied?: (scopeRepositoryIds: number[]) => void;
  /** 多仓（≥2）：后台仅执行 GitNexus 官方仓库组（create / add / sync） */
  onAssociationBuild?: (repositoryIds: number[]) => void | Promise<void>;
  /**
   * 为 true 时仍可打开面板选择「全部仓库 / 自选」，但不会调用 `onAssociationBuild`（需先完成当前仓图谱检索）。
   */
  syncDisabled?: boolean;
}

function labelForTrigger(
  repos: CodeGraphRepositoryMenuItem[],
  candidateIds: number[],
  value: AssociationGraphConfig,
): string {
  if (candidateIds.length <= 1) return "关联检索";
  if (value.mode === "all") {
    return `全部仓库（${candidateIds.length}）`;
  }
  const names = value.customRepositoryIds
    .map((id) => repos.find((r) => r.id === id)?.name)
    .filter(Boolean) as string[];
  if (names.length === 0) return "关联检索";
  const joined = names.join(" · ");
  if (joined.length <= 28) return joined;
  return `${joined.slice(0, 26)}…`;
}

export function CodeGraphAssociationPopover({
  repositories,
  candidateRepositoryIds,
  activeRepositoryId,
  value,
  onChange,
  onApplied,
  onAssociationBuild,
  syncDisabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<AssociationGraphMode>(value.mode);
  const [draftCustom, setDraftCustom] = useState<number[]>(value.customRepositoryIds);

  const candidates = useMemo(() => {
    const set = new Set(candidateRepositoryIds.filter((id) => Number.isFinite(id)));
    return repositories.filter((r) => set.has(r.id));
  }, [repositories, candidateRepositoryIds]);

  const canUse = candidates.length > 1;

  useEffect(() => {
    if (!open) return;
    setDraftMode(value.mode);
    setDraftCustom(value.customRepositoryIds);
  }, [open, value.mode, value.customRepositoryIds]);

  const apply = useCallback(() => {
    const next: AssociationGraphConfig =
      draftMode === "all"
        ? { mode: "all", customRepositoryIds: [] }
        : {
            mode: "custom",
            customRepositoryIds: [...new Set(draftCustom)].filter((id) => candidateRepositoryIds.includes(id)),
          };
    if (next.mode === "custom" && next.customRepositoryIds.length === 0 && activeRepositoryId != null) {
      next.customRepositoryIds = [activeRepositoryId];
    }
    onChange(next);
    const scopeIds = resolveAssociationRepositoryIds(next, candidateRepositoryIds, activeRepositoryId);
    if (!syncDisabled && scopeIds.length >= 2) {
      void onAssociationBuild?.(scopeIds);
    }
    onApplied?.(scopeIds);
    setOpen(false);
  }, [
    draftMode,
    draftCustom,
    candidateRepositoryIds,
    activeRepositoryId,
    onChange,
    onApplied,
    onAssociationBuild,
    syncDisabled,
  ]);

  const toggleRepo = useCallback(
    (repoId: number, checked: boolean) => {
      setDraftCustom((prev) => {
        const s = new Set(prev);
        if (checked) s.add(repoId);
        else s.delete(repoId);
        return Array.from(s).sort((a, b) => a - b);
      });
    },
    [],
  );

  const onCheckAllChange = useCallback(
    (e: CheckboxChangeEvent) => {
      if (e.target.checked) {
        setDraftCustom(candidateRepositoryIds.slice(0, 20));
      } else {
        setDraftCustom(activeRepositoryId != null ? [activeRepositoryId] : []);
      }
    },
    [candidateRepositoryIds, activeRepositoryId],
  );

  const body = (
    <div className="app-code-graph-assoc-dropdown" onClick={(ev) => ev.stopPropagation()}>
      <div className="app-code-graph-assoc-dropdown-header">
        <Typography.Text type="secondary" className="app-code-graph-assoc-dropdown-title">
          关联检索
        </Typography.Text>
        <Typography.Paragraph type="secondary" className="app-code-graph-assoc-dropdown-desc">
          选择参与合并的仓库。多仓跨仓依赖 GitNexus 官方<strong>仓库组</strong>（<Typography.Text code>gitnexus group create</Typography.Text> /{" "}
          <Typography.Text code>add</Typography.Text> / <Typography.Text code>sync</Typography.Text>
          ）登记并同步跨仓合约。点击下方「同步仓库组」即调用上述 CLI 并刷新多仓合并子图；各仓本地代码图谱请在仓库菜单中单独「开始检索」。
        </Typography.Paragraph>
      </div>
      <Radio.Group
        className="app-code-graph-assoc-mode"
        value={draftMode}
        onChange={(e) => {
          const m = e.target.value as AssociationGraphMode;
          setDraftMode(m);
          if (m === "custom") {
            setDraftCustom((prev) => {
              if (prev.length) return prev;
              if (activeRepositoryId != null) return [activeRepositoryId];
              return candidateRepositoryIds.slice(0, 1);
            });
          }
        }}
      >
        <Space direction="vertical" size={6}>
          <Radio value="all">全部仓库（{candidates.length}）</Radio>
          <Radio value="custom">自选仓库</Radio>
        </Space>
      </Radio.Group>
      {draftMode === "custom" ? (
        <div className="app-code-graph-assoc-check-wrap">
          <Checkbox
            className="app-code-graph-assoc-check-all"
            indeterminate={
              draftCustom.length > 0 && draftCustom.length < candidateRepositoryIds.length
            }
            checked={
              candidateRepositoryIds.length > 0 && draftCustom.length === candidateRepositoryIds.length
            }
            onChange={onCheckAllChange}
          >
            全选候选
          </Checkbox>
          <div className="app-code-graph-assoc-check-list">
            {candidates.map((r) => (
              <Checkbox
                key={r.id}
                checked={draftCustom.includes(r.id)}
                onChange={(e) => toggleRepo(r.id, e.target.checked)}
              >
                {r.name}
              </Checkbox>
            ))}
          </div>
        </div>
      ) : null}
      <div className="app-code-graph-assoc-actions">
        <Space wrap>
          <Button size="small" onClick={() => setOpen(false)}>
            取消
          </Button>
          {syncDisabled ? (
            <Tooltip title="请先完成当前仓库的代码图谱检索（「开始检索」成功）后，再同步 GitNexus 仓库组。">
              <Button type="primary" size="small" onClick={apply}>
                确定
              </Button>
            </Tooltip>
          ) : (
            <Button type="primary" size="small" onClick={apply}>
              同步仓库组
            </Button>
          )}
        </Space>
      </div>
    </div>
  );

  const triggerLabel = labelForTrigger(repositories, candidateRepositoryIds, value);

  return (
    <Popover
      open={open && canUse}
      onOpenChange={(next) => {
        if (!canUse) return;
        setOpen(next);
      }}
      trigger="click"
      placement="bottomLeft"
      content={body}
      rootClassName="app-code-graph-assoc-popover-root"
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className={`app-code-graph-assoc-trigger${open && canUse ? " app-code-graph-assoc-trigger--open" : ""}`}
        disabled={!canUse}
        title={
          !canUse
            ? "当前仅有一个候选仓库，无法关联检索"
            : syncDisabled
              ? "可先选择关联范围；完成本仓库检索后，再在面板内同步 GitNexus 仓库组。"
              : "关联检索：选择范围后点击「同步仓库组」"
        }
        aria-label="关联检索"
        aria-expanded={open && canUse}
      >
        <CodeGraphAssociationIcon className="app-code-graph-assoc-trigger-icon" />
        <span className="app-code-graph-assoc-trigger-label">{triggerLabel}</span>
      </button>
    </Popover>
  );
}
