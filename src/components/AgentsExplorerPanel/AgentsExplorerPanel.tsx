import {
  App,
  Button,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  CompassOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { scanAgentsDirectory, readAgentsFile } from "../../services/agentsExplorer";
import { openInFinder } from "../../services/repository";
import type {
  AgentsAgentEntry,
  AgentsCommandEntry,
  AgentsDirectoryScan,
  AgentsOtherEntry,
  AgentsSkillEntry,
} from "../../types/agentsExplorer";
import {
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import "./AgentsExplorerPanel.css";

export interface AgentsExplorerPanelProps {
  repositoryPath?: string | null;
  onClose?: () => void;
}

export type ExploreTab = "commands" | "skills" | "agents" | "others";

export interface RowMeta {
  name: string;
  description?: string;
  relPath: string;
  path: string;
  tags: string[];
}

const EMPTY_SCAN: AgentsDirectoryScan = {
  rootPath: null,
  exists: false,
  commands: [],
  skills: [],
  agents: [],
  others: [],
};

interface PreviewState {
  title: string;
  path: string;
  content: string;
  truncated: boolean;
}

const SUGGESTED_STRUCTURE = `.agents/
├── commands/          # 斜杠命令：commands/review.md → /review
├── skills/            # 技能：skills/<name>/SKILL.md
├── agents/            # 智能体定义：agents/<name>.md
└── hooks/…            # Hooks、脚本等其他资产`;

export function rowFromCommand(c: AgentsCommandEntry): RowMeta {
  return {
    name: `/${c.name}`,
    description: c.description,
    relPath: c.relPath,
    path: c.path,
    tags: [
      c.allowedTools ? `工具: ${c.allowedTools}` : "",
      c.model ? `模型: ${c.model}` : "",
      c.argumentHint ? `参数: ${c.argumentHint}` : "",
    ].filter(Boolean),
  };
}

export function rowFromSkill(s: AgentsSkillEntry): RowMeta {
  return {
    name: s.name,
    description: s.description,
    relPath: s.relPath,
    path: s.path,
    tags: ["技能"],
  };
}

export function rowFromAgent(a: AgentsAgentEntry): RowMeta {
  return {
    name: a.name,
    description: a.description,
    relPath: a.relPath,
    path: a.path,
    tags: [
      a.model ? `模型: ${a.model}` : "",
      a.tools.length > 0 ? `工具: ${a.tools.join(", ")}` : "",
    ].filter(Boolean),
  };
}

export function rowFromOther(o: AgentsOtherEntry): RowMeta {
  return {
    name: o.isDir ? `${o.name}/` : o.name,
    description: o.isDir ? "目录" : "文件",
    relPath: o.relPath,
    path: o.path,
    tags: [o.isDir ? "目录" : "文件"],
  };
}

/** 按分类 + 搜索词构建展示行（纯函数，便于单测）。 */
export function buildRows(scan: AgentsDirectoryScan, tab: ExploreTab, query: string): RowMeta[] {
  const q = query.trim().toLowerCase();
  let items: RowMeta[];
  switch (tab) {
    case "skills":
      items = scan.skills.map(rowFromSkill);
      break;
    case "agents":
      items = scan.agents.map(rowFromAgent);
      break;
    case "others":
      items = scan.others.map(rowFromOther);
      break;
    default:
      items = scan.commands.map(rowFromCommand);
  }
  if (!q) return items;
  return items.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      r.relPath.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export function scanCounts(scan: AgentsDirectoryScan): Record<ExploreTab, number> {
  return {
    commands: scan.commands.length,
    skills: scan.skills.length,
    agents: scan.agents.length,
    others: scan.others.length,
  };
}

export function AgentsExplorerPanel({ repositoryPath, onClose }: AgentsExplorerPanelProps) {
  const { message } = App.useApp();
  const [scan, setScan] = useState<AgentsDirectoryScan>(EMPTY_SCAN);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<ExploreTab>("commands");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const repoPath = repositoryPath?.trim() || "";

  const refresh = useCallback(async () => {
    if (!repoPath) {
      setScan(EMPTY_SCAN);
      return;
    }
    setLoading(true);
    try {
      const next = await scanAgentsDirectory(repoPath);
      setScan(next);
      if (next.exists) {
        const counts = scanCounts(next);
        if (counts[tab] === 0) {
          const firstNonEmpty = (["commands", "skills", "agents", "others"] as const).find(
            (t) => counts[t] > 0,
          );
          if (firstNonEmpty) setTab(firstNonEmpty);
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      setScan(EMPTY_SCAN);
    } finally {
      setLoading(false);
    }
  }, [message, repoPath, tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openPreview = useCallback(
    async (row: RowMeta) => {
      setPreview({
        title: row.name,
        path: row.path,
        content: "",
        truncated: false,
      });
      setPreviewLoading(true);
      try {
        const file = await readAgentsFile(row.path);
        setPreview((prev) =>
          prev
            ? { title: prev.title, path: file.path, content: file.content, truncated: file.truncated }
            : prev,
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [message],
  );

  const openAgentsFolder = useCallback(async () => {
    const root = scan.rootPath;
    if (!root) {
      message.warning("当前仓库没有 .agents 目录");
      return;
    }
    try {
      await openInFinder(root);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "打开目录失败");
    }
  }, [message, scan.rootPath]);

  const rows = useMemo(() => buildRows(scan, tab, query), [query, scan, tab]);

  const counts = useMemo(() => scanCounts(scan), [scan]);

  const tabCountLabel = useCallback(
    (key: ExploreTab) => (scan.exists ? counts[key] : 0),
    [counts, scan.exists],
  );

  const body = useMemo(() => {
    if (!repoPath) {
      return (
        <div className="app-agents-explorer-state">
          <Empty description="请先在左侧选择仓库，再探索其 .agents 目录" />
        </div>
      );
    }
    if (loading) {
      return (
        <div className="app-agents-explorer-state">
          <Spin tip="正在扫描 .agents 目录…">
            <div className="app-agents-explorer-spin-box" />
          </Spin>
        </div>
      );
    }
    if (!scan.exists) {
      return (
        <div className="app-agents-explorer-state">
          <Empty
            description={
              <span>
                当前仓库还没有 <Typography.Text code>.agents</Typography.Text> 目录
              </span>
            }
          >
            <pre className="app-agents-explorer-structure">{SUGGESTED_STRUCTURE}</pre>
            <Typography.Paragraph type="secondary" className="app-agents-explorer-hint">
              在仓库根目录创建该结构后，Claude Code / Codex / opencode 会读取其中的命令、技能与智能体定义，
              这里会即时展示。
            </Typography.Paragraph>
          </Empty>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="app-agents-explorer-state">
          <Empty description={query ? "没有匹配的条目" : "该分类下暂无内容"} />
        </div>
      );
    }
    return (
      <div className="app-agents-explorer-list">
        {rows.map((row) => (
          <button
            type="button"
            key={row.path}
            className="app-agents-explorer-card"
            onClick={() => void openPreview(row)}
            title={`${row.relPath} · 点击预览`}
          >
            <div className="app-agents-explorer-card-main">
              <div className="app-agents-explorer-card-name">{row.name}</div>
              {row.description ? (
                <div className="app-agents-explorer-card-desc">{row.description}</div>
              ) : null}
              <div className="app-agents-explorer-card-path">{row.relPath}</div>
            </div>
            <div className="app-agents-explorer-card-tags">
              {row.tags.map((t) => (
                <Tag key={t} bordered={false} className="app-agents-explorer-tag">
                  {t}
                </Tag>
              ))}
            </div>
          </button>
        ))}
      </div>
    );
  }, [loading, openPreview, query, repoPath, rows, scan.exists]);

  return (
    <AuthorPanelPageShell
      icon={<CompassOutlined />}
      title="Agents 探索"
      subtitle="浏览仓库 .agents 目录下的命令、技能、智能体与资产（只读）"
      actions={
        <Space size={8} wrap>
          <Input
            allowClear
            size="small"
            className="app-agents-explorer-search"
            prefix={<SearchOutlined />}
            placeholder="搜索名称、描述或路径"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            disabled={!scan.exists}
            onClick={() => void openAgentsFolder()}
          >
            打开目录
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        </Space>
      }
    >
      <div className="app-agents-explorer">
        <AuthorPanelHubTabs aria-label="Agents 资产分类">
          {(
            [
              { key: "commands", label: "命令" },
              { key: "skills", label: "技能" },
              { key: "agents", label: "智能体" },
              { key: "others", label: "其他" },
            ] as const
          ).map((t) => (
            <AuthorPanelHubTab
              key={t.key}
              active={tab === t.key}
              label={t.label}
              count={tabCountLabel(t.key)}
              onClick={() => setTab(t.key)}
            />
          ))}
        </AuthorPanelHubTabs>
        {body}
      </div>
      <Drawer
        open={preview != null}
        onClose={() => setPreview(null)}
        size={560}
        title={preview ? `${preview.title} · 预览` : "预览"}
        extra={
          preview ? (
            <Typography.Text type="secondary" className="app-agents-explorer-preview-path">
              {preview.path}
            </Typography.Text>
          ) : null
        }
      >
        {previewLoading ? (
          <div className="app-agents-explorer-state">
            <Spin />
          </div>
        ) : preview ? (
          <>
            {preview.truncated ? (
              <Typography.Paragraph type="warning" className="app-agents-explorer-truncated">
                文件较大，仅展示前 200,000 字符。
              </Typography.Paragraph>
            ) : null}
            <pre className="app-agents-explorer-preview">{preview.content}</pre>
          </>
        ) : null}
      </Drawer>
    </AuthorPanelPageShell>
  );
}
