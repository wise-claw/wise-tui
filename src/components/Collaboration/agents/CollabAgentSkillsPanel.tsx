import { useEffect, useState } from "react";
import { Button, Input, Select, Space, Switch, Table, Typography } from "antd";
import { listMcpServers, type McpServer } from "../../../services/mcp";
import { getWiseSkillsHome, scanSkillPath, type ScannedSkill } from "../../../services/skills";
import { repositoryWorkspaceLabel } from "../../../services/collaboration";
import type { Repository } from "../../../types";
import type { CollabMcpBinding, CollabSkillBinding } from "../../../types/collaboration";

interface Props {
  skills: CollabSkillBinding[];
  mcps: CollabMcpBinding[];
  repositories: Repository[];
  onSkillsChange: (next: CollabSkillBinding[]) => void;
  onMcpsChange: (next: CollabMcpBinding[]) => void;
}

/** 技能 / MCP：从已有能力中选择，设置必需/可选、适用仓库与工具范围；不自动安装或连接外部服务。 */
export function CollabAgentSkillsPanel({ skills, mcps, repositories, onSkillsChange, onMcpsChange }: Props) {
  const [available, setAvailable] = useState<ScannedSkill[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);

  useEffect(() => {
    void getWiseSkillsHome()
      .then((home) => (home ? scanSkillPath(home) : []))
      .then((rows) => setAvailable(rows.filter((s) => s.hasSkillMd)))
      .catch(() => setAvailable([]));
    void listMcpServers()
      .then(setServers)
      .catch(() => setServers([]));
  }, []);

  const patchSkill = (id: string, patch: Partial<CollabSkillBinding>) =>
    onSkillsChange(skills.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const patchMcp = (id: string, patch: Partial<CollabMcpBinding>) =>
    onMcpsChange(mcps.map((m) => (m.serverId === id ? { ...m, ...patch } : m)));

  const repoOptions = repositories.map((r) => ({ value: r.id, label: repositoryWorkspaceLabel(r) }));

  return (
    <>
      <div className="collab-section-title">技能</div>
      <Select
        style={{ width: "100%", marginBottom: 8 }}
        placeholder="从 Wise 技能库添加"
        value={null}
        showSearch
        options={available
          .filter((s) => !skills.some((b) => b.id === s.name))
          .map((s) => ({ value: s.name, label: s.name }))}
        onChange={(name: string) => {
          const s = available.find((x) => x.name === name);
          if (!s) return;
          onSkillsChange([
            ...skills,
            { id: s.name, label: s.name, sourcePath: s.location, version: null, required: false, repositoryIds: [], params: null },
          ]);
        }}
      />
      <Table<CollabSkillBinding>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={skills}
        locale={{ emptyText: "未挂载技能" }}
        columns={[
          { title: "技能", render: (_, s) => <Typography.Text>{s.label}</Typography.Text> },
          {
            title: "来源路径",
            render: (_, s) => (
              <Input size="small" value={s.sourcePath ?? ""} onChange={(e) => patchSkill(s.id, { sourcePath: e.target.value || null })} />
            ),
          },
          {
            title: "适用仓库（空=全部）",
            width: 220,
            render: (_, s) => (
              <Select
                size="small"
                mode="multiple"
                style={{ width: "100%" }}
                value={s.repositoryIds}
                options={repoOptions}
                onChange={(v: number[]) => patchSkill(s.id, { repositoryIds: v })}
              />
            ),
          },
          {
            title: "必需",
            width: 60,
            render: (_, s) => <Switch size="small" checked={s.required} onChange={(v) => patchSkill(s.id, { required: v })} />,
          },
          {
            title: "",
            width: 60,
            render: (_, s) => (
              <Button size="small" type="link" danger onClick={() => onSkillsChange(skills.filter((x) => x.id !== s.id))}>
                移除
              </Button>
            ),
          },
        ]}
      />

      <div className="collab-section-title">MCP</div>
      <Space.Compact style={{ width: "100%", marginBottom: 8 }}>
        <Select
          style={{ width: "100%" }}
          placeholder="从已配置的 MCP 服务添加"
          value={null}
          showSearch
          options={servers
            .filter((s) => !mcps.some((m) => m.serverId === s.name || m.serverId === s.id))
            .map((s) => ({ value: s.name, label: `${s.name}${s.enabled ? "" : "（已停用）"}` }))}
          onChange={(name: string) =>
            onMcpsChange([...mcps, { serverId: name, label: name, tools: [], credentialRef: null, required: false, sourcePath: null }])
          }
        />
      </Space.Compact>
      <Table<CollabMcpBinding>
        size="small"
        rowKey="serverId"
        pagination={false}
        dataSource={mcps}
        locale={{ emptyText: "未挂载 MCP；严格隔离时智能体只会看到这里列出的服务" }}
        columns={[
          { title: "服务", render: (_, m) => <Typography.Text>{m.label}</Typography.Text> },
          {
            title: "允许的工具（空=全部）",
            render: (_, m) => (
              <Select
                size="small"
                mode="tags"
                style={{ width: "100%" }}
                value={m.tools}
                onChange={(v: string[]) => patchMcp(m.serverId, { tools: v })}
              />
            ),
          },
          {
            title: "配置文件",
            width: 200,
            render: (_, m) => (
              <Input
                size="small"
                placeholder="额外 .mcp.json 路径"
                value={m.sourcePath ?? ""}
                onChange={(e) => patchMcp(m.serverId, { sourcePath: e.target.value || null })}
              />
            ),
          },
          {
            title: "必需",
            width: 60,
            render: (_, m) => <Switch size="small" checked={m.required} onChange={(v) => patchMcp(m.serverId, { required: v })} />,
          },
          {
            title: "",
            width: 60,
            render: (_, m) => (
              <Button size="small" type="link" danger onClick={() => onMcpsChange(mcps.filter((x) => x.serverId !== m.serverId))}>
                移除
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
