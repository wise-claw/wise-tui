import { useEffect, useState } from "react";
import { Alert, Descriptions, Empty, Select, Space, Table, Tag, Typography } from "antd";
import { formatCollabError, getCollabEffectiveConfig } from "../../../services/collaboration";
import type { ProjectItem, Repository } from "../../../types";
import type { CollabAgentBinding, CollabEffectiveConfigManifest } from "../../../types/collaboration";

interface Props {
  agentId: string;
  bindings: CollabAgentBinding[];
  projects: ProjectItem[];
  repositories: Repository[];
  knownMcpServerIds: string[];
  activeRevision: number;
}

const SOURCE_LABEL: Record<string, string> = {
  base: "基础配置",
  agent: "基础配置",
  repository_override: "仓库覆盖",
  override: "仓库覆盖",
  repository_file: "仓库原文件",
  repository: "仓库原文件",
};

const STATUS_COLOR: Record<string, string> = {
  active: "success",
  enabled: "success",
  degraded: "warning",
  unavailable: "warning",
  disabled: "default",
  missing: "error",
  blocked: "error",
};

/** 先选仓库与版本，再展示每一项的来源与状态；不把所有仓库的配置拼在一起预览。 */
export function CollabAgentEffectiveConfigPanel({
  agentId,
  bindings,
  projects,
  repositories,
  knownMcpServerIds,
  activeRevision,
}: Props) {
  const [bindingId, setBindingId] = useState<string | null>(bindings[0]?.id ?? null);
  const [manifest, setManifest] = useState<CollabEffectiveConfigManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const binding = bindings.find((b) => b.id === bindingId) ?? null;

  useEffect(() => {
    if (!binding) {
      setManifest(null);
      return;
    }
    setError(null);
    getCollabEffectiveConfig({
      agentId,
      revision: activeRevision || null,
      projectId: binding.projectId,
      repositoryId: binding.repositoryId,
      knownMcpServerIds: knownMcpServerIds.length ? knownMcpServerIds : null,
    })
      .then(setManifest)
      .catch((e) => {
        setManifest(null);
        setError(formatCollabError(e));
      });
  }, [activeRevision, agentId, binding, knownMcpServerIds]);

  const label = (b: CollabAgentBinding) =>
    `${repositories.find((r) => r.id === b.repositoryId)?.name ?? `#${b.repositoryId}`} · ${
      projects.find((p) => p.id === b.projectId)?.name ?? b.projectId
    }`;

  if (!bindings.length) return <Empty description="先绑定仓库，再查看该仓库下的实际生效配置" />;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={10}>
      <Space wrap>
        <span>仓库</span>
        <Select
          style={{ width: 320 }}
          value={bindingId ?? undefined}
          options={bindings.map((b) => ({ value: b.id, label: label(b) }))}
          onChange={setBindingId}
        />
        <Typography.Text type="secondary">
          {activeRevision ? `按生效版本 v${activeRevision} 解析` : "尚未发布，按草稿解析"}
        </Typography.Text>
      </Space>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {manifest ? (
        <>
          {manifest.blocked ? (
            <Alert type="error" showIcon message="该仓库下无法执行" description={manifest.blockReasons.join("；")} />
          ) : null}
          {manifest.degradations.length ? (
            <Alert type="warning" showIcon message="降级项" description={manifest.degradations.join("；")} />
          ) : null}
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="执行环境">{manifest.engineId}</Descriptions.Item>
            <Descriptions.Item label="模型">{manifest.model ?? "默认"}</Descriptions.Item>
            <Descriptions.Item label="隔离">{manifest.isolation === "strict" ? "严格" : "尽力"}</Descriptions.Item>
            <Descriptions.Item label="读写范围">{manifest.accessScope === "read" ? "只读" : "读写"}</Descriptions.Item>
            <Descriptions.Item label="配置哈希">{manifest.configHash.slice(0, 12)}</Descriptions.Item>
            <Descriptions.Item label="仓库覆盖">{manifest.repositoryOverrideApplied ? "已应用" : "无"}</Descriptions.Item>
            <Descriptions.Item label="独立指令" span={2}>
              {manifest.capabilities.independentInstructions}
            </Descriptions.Item>
            <Descriptions.Item label="MCP 限制" span={2}>
              {manifest.capabilities.mcpRestriction}
            </Descriptions.Item>
            <Descriptions.Item label="记忆隔离" span={2}>
              {manifest.capabilities.memoryIsolation}
            </Descriptions.Item>
          </Descriptions>
          <div className="collab-section-title">仓库适用规则（来自仓库原文件，只读）</div>
          {manifest.repoRules.length ? (
            <Space size={4} wrap>
              {manifest.repoRules.map((r) => (
                <Tag key={r.path}>
                  {r.path} · {r.scope}
                </Tag>
              ))}
            </Space>
          ) : (
            <Typography.Text type="secondary">未发现仓库原生规则文件</Typography.Text>
          )}
          <div className="collab-section-title">知识</div>
          <Table
            size="small"
            rowKey="resourceId"
            pagination={false}
            dataSource={manifest.knowledge}
            locale={{ emptyText: "无" }}
            columns={[
              { title: "资源", dataIndex: "label" },
              { title: "版本", render: (_, k) => (k.pinnedVersion ? `固定 v${k.pinnedVersion}` : "最新") },
              { title: "来源", render: (_, k) => SOURCE_LABEL[k.source] ?? k.source },
            ]}
          />
          <div className="collab-section-title">技能</div>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={manifest.skills}
            locale={{ emptyText: "无" }}
            columns={[
              { title: "技能", dataIndex: "label" },
              { title: "状态", render: (_, s) => <Tag color={STATUS_COLOR[s.status] ?? "default"}>{s.status}</Tag> },
              { title: "来源", render: (_, s) => SOURCE_LABEL[s.source] ?? s.source },
              { title: "说明", render: (_, s) => s.reason ?? (s.required ? "必需" : "可选") },
            ]}
          />
          <div className="collab-section-title">MCP</div>
          <Table
            size="small"
            rowKey="serverId"
            pagination={false}
            dataSource={manifest.mcps}
            locale={{ emptyText: "无" }}
            columns={[
              { title: "服务", dataIndex: "label" },
              { title: "工具", render: (_, m) => (m.tools.length ? m.tools.join("、") : "全部") },
              { title: "状态", render: (_, m) => <Tag color={STATUS_COLOR[m.status] ?? "default"}>{m.status}</Tag> },
              { title: "来源", render: (_, m) => SOURCE_LABEL[m.source] ?? m.source },
              { title: "说明", render: (_, m) => m.reason ?? (m.required ? "必需" : "可选") },
            ]}
          />
        </>
      ) : null}
    </Space>
  );
}
