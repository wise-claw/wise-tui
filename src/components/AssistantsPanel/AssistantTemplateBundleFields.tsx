import { Select, Spin, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { AssistantRuntimeBundle } from "../../services/assistantPromptLayers";
import { detectExternalSkillPaths, scanSkillPath } from "../../services/skills";
import { listMcpServers } from "../../services/mcp";
import {
  scannedSkillToMountCandidate,
  type SkillMountCandidate,
} from "../CockpitSurface/assistantSkillMount";

export interface AssistantTemplateBundleFieldsProps {
  skillBundle: AssistantRuntimeBundle;
  mcpBundle: AssistantRuntimeBundle;
  onSkillBundleChange: (bundle: AssistantRuntimeBundle) => void;
  onMcpBundleChange: (bundle: AssistantRuntimeBundle) => void;
}

interface PoolItem {
  id: string;
  label: string;
  origin?: string;
  sourcePath?: string;
}

function selectedIdsFromBundle(bundle: AssistantRuntimeBundle): string[] {
  const disabled = new Set(bundle.disabled);
  return bundle.custom.filter((item) => !disabled.has(item.id)).map((item) => item.id);
}

function buildBundleFromSelection(selectedIds: string[], pool: PoolItem[]): AssistantRuntimeBundle {
  const selected = new Set(selectedIds);
  return {
    disabled: [],
    custom: pool
      .filter((item) => selected.has(item.id))
      .map((item) => ({
        id: item.id,
        label: item.label,
        origin: item.origin ?? "custom",
        ...(item.sourcePath ? { sourcePath: item.sourcePath } : {}),
      })),
  };
}

export function AssistantTemplateBundleFields({
  skillBundle,
  mcpBundle,
  onSkillBundleChange,
  onMcpBundleChange,
}: AssistantTemplateBundleFieldsProps) {
  const [skillLoading, setSkillLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [skillPool, setSkillPool] = useState<PoolItem[]>([]);
  const [mcpPool, setMcpPool] = useState<PoolItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSkillLoading(true);
    detectExternalSkillPaths()
      .then(async (paths) => {
        const activePaths = paths.filter((path) => path.exists && path.count > 0);
        const candidates: SkillMountCandidate[] = [];
        for (const path of activePaths) {
          const scanned = await scanSkillPath(path.path).catch(() => []);
          for (const skill of scanned) {
            if (!skill.hasSkillMd) continue;
            candidates.push(scannedSkillToMountCandidate(skill));
          }
        }
        if (cancelled) return;
        const byId = new Map<string, PoolItem>();
        for (const candidate of candidates) {
          byId.set(candidate.id, {
            id: candidate.id,
            label: candidate.label,
            origin: candidate.origin,
            sourcePath: candidate.sourcePath,
          });
        }
        for (const item of skillBundle.custom) {
          if (!byId.has(item.id)) {
            byId.set(item.id, {
              id: item.id,
              label: item.label,
              origin: item.origin ?? "custom",
              sourcePath: item.sourcePath,
            });
          }
        }
        setSkillPool([...byId.values()].sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {
        if (!cancelled) {
          setSkillPool(
            skillBundle.custom.map((item) => ({
              id: item.id,
              label: item.label,
              origin: item.origin ?? "custom",
              sourcePath: item.sourcePath,
            })),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSkillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillBundle.custom]);

  useEffect(() => {
    let cancelled = false;
    setMcpLoading(true);
    listMcpServers()
      .then((servers) => {
        if (cancelled) return;
        const byId = new Map<string, PoolItem>();
        for (const server of servers) {
          byId.set(server.id, {
            id: server.id,
            label: server.name.trim() || server.id,
            origin: server.source,
          });
        }
        for (const item of mcpBundle.custom) {
          if (!byId.has(item.id)) {
            byId.set(item.id, {
              id: item.id,
              label: item.label,
              origin: item.origin ?? "custom",
            });
          }
        }
        setMcpPool([...byId.values()].sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {
        if (!cancelled) {
          setMcpPool(
            mcpBundle.custom.map((item) => ({
              id: item.id,
              label: item.label,
              origin: item.origin ?? "custom",
            })),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setMcpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mcpBundle.custom]);

  const skillOptions = useMemo(
    () => skillPool.map((item) => ({ value: item.id, label: item.label })),
    [skillPool],
  );
  const mcpOptions = useMemo(
    () => mcpPool.map((item) => ({ value: item.id, label: item.label })),
    [mcpPool],
  );

  return (
    <div className="assistant-template-bundle-fields">
      <div className="assistant-template-bundle-fields__section">
        <Typography.Text strong>Skills</Typography.Text>
        <Typography.Paragraph type="secondary" className="assistant-template-bundle-fields__help">
          从本机技能目录选择默认挂载的 Skill；保存后可在助手设置中继续调整。
        </Typography.Paragraph>
        {skillLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            mode="multiple"
            allowClear
            size="small"
            placeholder={skillOptions.length > 0 ? "选择默认 Skill" : "暂无可用 Skill，请先在技能市场添加"}
            options={skillOptions}
            value={selectedIdsFromBundle(skillBundle)}
            onChange={(ids) => onSkillBundleChange(buildBundleFromSelection(ids, skillPool))}
            optionFilterProp="label"
            style={{ width: "100%" }}
          />
        )}
      </div>
      <div className="assistant-template-bundle-fields__section">
        <Typography.Text strong>MCP</Typography.Text>
        <Typography.Paragraph type="secondary" className="assistant-template-bundle-fields__help">
          选择助手默认启用的 MCP 服务；需先在 MCP 工具中注册。
        </Typography.Paragraph>
        {mcpLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            mode="multiple"
            allowClear
            size="small"
            placeholder={mcpOptions.length > 0 ? "选择默认 MCP" : "暂无 MCP 服务，请先在 MCP 工具中添加"}
            options={mcpOptions}
            value={selectedIdsFromBundle(mcpBundle)}
            onChange={(ids) => onMcpBundleChange(buildBundleFromSelection(ids, mcpPool))}
            optionFilterProp="label"
            style={{ width: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
