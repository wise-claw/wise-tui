import { Button, Checkbox, Popover, Radio, Space, Typography } from "antd";
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
  /** 每次「重建关联索引」后触发；参数为解析后的参与仓库 id（与画布子图范围一致） */
  onApplied?: (scopeRepositoryIds: number[]) => void;
  /** 多仓（≥2）：提交后台「各仓索引重建 + OpenAPI 发现/合成路由 + 前后端 HTTP 桥接」任务 */
  onAssociationBuild?: (repositoryIds: number[]) => void | Promise<void>;
  /** 多仓（≥2）：仅 OpenAPI / 合成路由 + HTTP 桥接（不重建各仓 GitNexus 索引） */
  onOpenapiBridge?: (repositoryIds: number[]) => void | Promise<void>;
  disabled?: boolean;
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
  onOpenapiBridge,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<AssociationGraphMode>(value.mode);
  const [draftCustom, setDraftCustom] = useState<number[]>(value.customRepositoryIds);

  const candidates = useMemo(() => {
    const set = new Set(candidateRepositoryIds.filter((id) => Number.isFinite(id)));
    return repositories.filter((r) => set.has(r.id));
  }, [repositories, candidateRepositoryIds]);

  const canUse = candidates.length > 1 && !disabled;

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
    if (scopeIds.length >= 2) {
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
  ]);

  const applyOpenapiOnly = useCallback(() => {
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
    if (scopeIds.length < 2) {
      return;
    }
    void onOpenapiBridge?.(scopeIds);
    onApplied?.(scopeIds);
    setOpen(false);
  }, [
    draftMode,
    draftCustom,
    candidateRepositoryIds,
    activeRepositoryId,
    onChange,
    onApplied,
    onOpenapiBridge,
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
          选择参与合并的仓库。「重建关联索引」会依次为各仓重建 GitNexus 代码图谱，再导入 OpenAPI / 合成路由并做前后端 HTTP 桥接。「仅
          OpenAPI 桥接」在已有代码索引基础上刷新接口描述与跨仓调用边，耗时更短。全部完成后将刷新多仓合并子图。
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
          <Button size="small" disabled={!onOpenapiBridge} onClick={applyOpenapiOnly}>
            仅 OpenAPI 桥接
          </Button>
          <Button type="primary" size="small" onClick={apply}>
            重建关联索引
          </Button>
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
      getPopupContainer={(trigger) => trigger.closest(".app-code-graph-panel") ?? document.body}
    >
      <button
        type="button"
        className={`app-code-graph-assoc-trigger${open && canUse ? " app-code-graph-assoc-trigger--open" : ""}`}
        disabled={!canUse}
        title={
          canUse
            ? "关联检索：选择范围后「重建关联索引」或「仅 OpenAPI 桥接」以扩展多仓图谱"
            : "当前仅有一个候选仓库，无法关联检索"
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
