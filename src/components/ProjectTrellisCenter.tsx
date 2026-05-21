import {
  ApartmentOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  FileMarkdownOutlined,
  FolderOpenOutlined,
  ForkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Drawer,
  Empty,
  Input,
  Progress,
  Space,
  Spin,
  Tabs,
  Tag,
  Tree,
  Typography,
} from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectItem, Repository } from "../types";
import { useTrellisRuntime } from "../hooks/useTrellisRuntime";
import {
  compileTrellisWorkflow,
  getTrellisOnboardingState,
  type TrellisAgentGraphNode,
  type TrellisOnboardingState,
  type TrellisRuntimeEvent,
  type TrellisWorkflowCompiled,
} from "../services/trellisRuntime";
import {
  listTrellisSpecAreas,
  listTrellisSpecTree,
  readTrellisSpecFile,
  writeTrellisSpecFile,
  type TrellisSpecArea,
  type TrellisSpecFile,
  type TrellisSpecTreeNode,
} from "../services/trellisSpecBridge";
import "./ProjectTrellisCenter.css";

interface ProjectTrellisCenterProps {
  open: boolean;
  inline?: boolean;
  project: ProjectItem | null;
  repositories?: Repository[];
  onClose?: () => void;
  onOpenProjectSession?: (project: ProjectItem) => void | Promise<void>;
  onRequestSpecAgentUpdate?: (project: ProjectItem, area: string) => void | Promise<void>;
}

const WORKFLOW_NODE_LABELS: Record<string, string> = {
  "1": "Plan",
  "2": "Execute",
  "3": "Finish",
};

type TrellisTransparencyNode = {
  id: string;
  label: string;
  detail: string;
  status: string;
  description: string;
  files: string[];
  phaseId?: "1" | "2" | "3";
  lane: "boot" | "dispatch" | "finish";
};

const TRELLIS_TRANSPARENCY_NODES: TrellisTransparencyNode[] = [
  {
    id: "session-start",
    label: "SessionStart",
    detail: "boot brief",
    status: "startup / clear / compact",
    description: "装载当前任务、Phase Index、spec scope 与首轮上下文。",
    files: [".claude/hooks/session-start.py", ".trellis/workflow.md", ".trellis/spec/"],
    lane: "boot",
  },
  {
    id: "current-state",
    label: "Current State",
    detail: "session snapshot",
    status: "task / git / journal",
    description: "把当前 task、git 状态、journal 行数写成会话快照。",
    files: [".trellis/.runtime/sessions/<key>.json", ".trellis/workspace/<dev>/journal-N.md"],
    lane: "boot",
  },
  {
    id: "spec-scope",
    label: "Spec Scope",
    detail: "scoped specs",
    status: ".trellis/spec",
    description: "按 package / active task 裁剪规范目录，避免无关规范注入。",
    files: [".trellis/spec/**/index.md", "Pre-Development Checklist"],
    lane: "boot",
  },
  {
    id: "workflow-state",
    label: "Workflow State",
    detail: "UserPromptSubmit",
    status: "[workflow-state:*]",
    description: "每轮从 workflow.md 取状态块，作为下一步动作提示。",
    files: [".claude/hooks/inject-workflow-state.py", ".trellis/workflow.md"],
    phaseId: "1",
    lane: "boot",
  },
  {
    id: "task-create",
    label: "task.py create",
    detail: "planning",
    status: "planning",
    description: "创建任务目录，落 task.json、prd.md、jsonl 占位。",
    files: [".trellis/tasks/<task>/task.json", "prd.md", "implement.jsonl", "check.jsonl"],
    phaseId: "1",
    lane: "boot",
  },
  {
    id: "task-artifacts",
    label: "Artifacts",
    detail: "prd / design / plan",
    status: "task directory",
    description: "沉淀 PRD、设计、执行清单和研究材料。",
    files: ["prd.md", "design.md", "implement.md", "research/"],
    phaseId: "1",
    lane: "boot",
  },
  {
    id: "research",
    label: "Research",
    detail: "trellis-research",
    status: "research/*.md",
    description: "只写 research 目录，补齐实现前的代码和领域证据。",
    files: [".trellis/tasks/<task>/research/", ".claude/agents/trellis-research.md"],
    phaseId: "1",
    lane: "dispatch",
  },
  {
    id: "context-jsonl",
    label: "Context JSONL",
    detail: "add-context",
    status: "curated context",
    description: "把需要注入的 spec、目录和原因写进 implement/check jsonl。",
    files: ["implement.jsonl", "check.jsonl", ".trellis/spec/**"],
    phaseId: "1",
    lane: "dispatch",
  },
  {
    id: "task-start",
    label: "task.py start",
    detail: "in_progress",
    status: "session.current_task",
    description: "任务从 planning 进入 in_progress，并绑定当前会话。",
    files: ["task.json.status", ".runtime/sessions/<key>.json"],
    phaseId: "2",
    lane: "dispatch",
  },
  {
    id: "pretooluse",
    label: "PreToolUse",
    detail: "Task / Agent",
    status: "<!-- trellis-hook-injected -->",
    description: "拦截 sub-agent 派发，读取 task artifacts 与 jsonl。",
    files: [".claude/hooks/inject-subagent-context.py", ".claude/agents/trellis-*.md"],
    phaseId: "2",
    lane: "dispatch",
  },
  {
    id: "prompt-patch",
    label: "Prompt Patch",
    detail: "updatedInput",
    status: "permissionDecision: allow",
    description: "把原 prompt 改写成带上下文、任务边界和 fallback 的输入。",
    files: ["hookSpecificOutput.updatedInput", "Active task: <path>"],
    phaseId: "2",
    lane: "dispatch",
  },
  {
    id: "subagents",
    label: "Subagents",
    detail: "dispatch",
    status: "implement / check / research",
    description: "主会话派发实现、检查、研究；子代理不再递归派发。",
    files: ["trellis-implement", "trellis-check", "trellis-research"],
    phaseId: "2",
    lane: "dispatch",
  },
  {
    id: "finish-check",
    label: "Check [finish]",
    detail: "quality gate",
    status: "trellis-check",
    description: "收尾前终检，确认实现、测试、规范要求都满足。",
    files: [".claude/agents/trellis-check.md", ".trellis/tasks/<task>/check.jsonl"],
    phaseId: "3",
    lane: "finish",
  },
  {
    id: "break-loop",
    label: "Break Loop",
    detail: "debug recap",
    status: "as needed",
    description: "反复失败时沉淀根因，防止同一问题循环修复。",
    files: [".claude/skills/trellis-break-loop", ".trellis/tasks/<task>/research/"],
    phaseId: "3",
    lane: "finish",
  },
  {
    id: "update-spec",
    label: "Update Spec",
    detail: "reflect",
    status: ".trellis/spec",
    description: "把新约束、约定和经验反哺到 spec，下次自动注入。",
    files: [".claude/skills/trellis-update-spec", ".trellis/spec/**"],
    phaseId: "3",
    lane: "finish",
  },
  {
    id: "commit",
    label: "Commit",
    detail: "checkpoint",
    status: "user confirmed",
    description: "用户确认后提交代码，保留可回溯的工程检查点。",
    files: ["git status", "git commit"],
    phaseId: "3",
    lane: "finish",
  },
  {
    id: "archive",
    label: "Archive",
    detail: "task.py archive",
    status: "completed",
    description: "完成任务，迁移到 archive，并清理 session pointer。",
    files: [".trellis/tasks/archive/{YYYY-MM}/", ".trellis/.runtime/sessions/"],
    phaseId: "3",
    lane: "finish",
  },
  {
    id: "journal",
    label: "Journal",
    detail: "journal",
    status: "session record",
    description: "追加会话标题、摘要和 commit 到开发者 journal。",
    files: [".trellis/scripts/add_session.py", ".trellis/workspace/<dev>/journal-N.md"],
    phaseId: "3",
    lane: "finish",
  },
];

const TRELLIS_TRANSPARENCY_LANES: Array<{
  id: TrellisTransparencyNode["lane"];
  title: string;
  nodes: TrellisTransparencyNode[];
}> = [
  { id: "boot", title: "启动 / 规划", nodes: TRELLIS_TRANSPARENCY_NODES.filter((node) => node.lane === "boot") },
  {
    id: "dispatch",
    title: "上下文 / 派发",
    nodes: TRELLIS_TRANSPARENCY_NODES.filter((node) => node.lane === "dispatch"),
  },
  { id: "finish", title: "验收 / 归档", nodes: TRELLIS_TRANSPARENCY_NODES.filter((node) => node.lane === "finish") },
];

const CHECK_LABELS: Record<string, string> = {
  trellis_dir: "Trellis 目录",
  task_py: "任务脚本",
  workflow: "工作流定义",
  spec: "规范目录",
  developer_identity: "开发者身份",
  codex_hooks: "Codex Hooks",
  claude_hooks: "Claude Hooks",
  task_workspace: "任务工作区",
};

export function ProjectTrellisCenter({
  open,
  inline = false,
  project,
  repositories = [],
  onClose,
  onOpenProjectSession,
  onRequestSpecAgentUpdate,
}: ProjectTrellisCenterProps) {
  const configuredRootPath = project?.rootPath?.trim() || null;
  const standaloneRepositoryProject = Boolean(project?.id.startsWith("repo:"));
  const memberRepositories = useMemo(() => {
    if (!project?.repositoryIds.length) return [];
    const ids = new Set(project.repositoryIds);
    return repositories.filter((repo) => ids.has(repo.id));
  }, [project?.repositoryIds, repositories]);
  const memberRepoRootConflict = useMemo(() => {
    if (standaloneRepositoryProject) return null;
    if (!configuredRootPath || memberRepositories.length === 0) return null;
    return memberRepositories.find((repo) => repo.path.trim() === configuredRootPath) ?? null;
  }, [configuredRootPath, memberRepositories, standaloneRepositoryProject]);
  const rootPath = memberRepoRootConflict ? null : configuredRootPath;
  const runtime = useTrellisRuntime({
    projectId: project?.id ?? null,
    rootPath,
    enabled: open && Boolean(project && rootPath),
  });

  const title = useMemo(
    () => (project ? `Trellis 工作区 · ${project.name}` : "Trellis 工作区"),
    [project],
  );
  const sddModeLabel = (project?.sddMode ?? "wise_trellis") === "wise_trellis" ? "Wise 接管" : "自有 SDD";

  const content = (
    <div className="project-trellis-center">
      <div className="project-trellis-center__toolbar" aria-label="Trellis 工作区状态">
        <Space size={6} wrap>
          <Tag color={rootPath ? "success" : "warning"}>{rootPath ? "根目录就绪" : "未绑定根目录"}</Tag>
          <Tag>{sddModeLabel}</Tag>
          {rootPath ? (
            <Typography.Text className="project-trellis-center__root" title={rootPath}>
              {rootPath}
            </Typography.Text>
          ) : null}
        </Space>
      </div>
      {memberRepoRootConflict ? (
        <Alert
          type="warning"
          showIcon
          className="project-trellis-center__root-alert"
          title="当前 Workspace rootPath 指向成员仓库"
          description={`请在工作区设置中重新绑定 Workspace 根目录。Standalone Repo 才使用仓库级 .trellis；当前成员仓：${memberRepoRootConflict.path}`}
        />
      ) : null}

      <Tabs
        className="project-trellis-center__tabs"
        items={[
          {
            key: "spec",
            label: "规范库",
            children: (
              <TrellisSpecTreePanel
                rootPath={rootPath}
                enabled={open}
                project={project}
                onOpenProjectSession={onOpenProjectSession}
                onRequestSpecAgentUpdate={onRequestSpecAgentUpdate}
              />
            ),
          },
          {
            key: "workflow",
            label: "工作流图",
            children: (
              <TrellisWorkflowMap
                projectId={project?.id ?? null}
                rootPath={rootPath}
                enabled={open}
              />
            ),
          },
          {
            key: "runtime",
            label: "运行证据",
            children: (
              <TrellisRuntimeOverview
                rootPath={rootPath}
                onboarding={runtime.onboarding}
                events={runtime.events}
                agentNodes={runtime.agentGraph?.nodes ?? []}
                loading={runtime.loading}
              />
            ),
          },
        ]}
      />
    </div>
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className="project-trellis-center__inline" aria-label={title}>
        {content}
      </div>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} size={1040} title={title}>
      {content}
    </Drawer>
  );
}

interface TrellisSpecTreePanelProps {
  rootPath?: string | null;
  enabled: boolean;
  project: ProjectItem | null;
  onOpenProjectSession?: (project: ProjectItem) => void | Promise<void>;
  onRequestSpecAgentUpdate?: (project: ProjectItem, area: string) => void | Promise<void>;
}

interface TrellisSpecTreeDataNode extends DataNode {
  specNode: TrellisSpecTreeNode;
  children?: TrellisSpecTreeDataNode[];
}

function TrellisSpecTreePanel({
  rootPath,
  enabled,
  project,
  onOpenProjectSession,
  onRequestSpecAgentUpdate,
}: TrellisSpecTreePanelProps) {
  const { message } = AntApp.useApp();
  const [areas, setAreas] = useState<TrellisSpecArea[]>([]);
  const [tree, setTree] = useState<TrellisSpecTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<TrellisSpecFile | null>(null);
  const [draft, setDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!enabled || !rootPath) {
      setAreas([]);
      setTree([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listTrellisSpecAreas(rootPath), listTrellisSpecTree(rootPath)])
      .then(([nextAreas, nextTree]) => {
        if (cancelled) return;
        setAreas(nextAreas);
        setTree(nextTree);
        setSelectedPath((current) => current ?? findFirstSpecFile(nextTree)?.relativePath ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, rootPath]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!enabled || !rootPath || !selectedPath) {
      setActiveFile(null);
      setDraft("");
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    readTrellisSpecFile(rootPath, selectedPath)
      .then((file) => {
        if (cancelled) return;
        setActiveFile(file);
        setDraft(file.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setActiveFile(null);
        setDraft("");
        setFileError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, rootPath, selectedPath]);

  const markdownCount = useMemo(() => countSpecMarkdown(tree), [tree]);
  const managedAreas = areas.filter((area) => area.hasIndex).length;
  const treeData = useMemo(() => tree.map(toSpecTreeDataNode), [tree]);
  const activeArea = selectedPath?.split("/")[0] ?? null;
  const hasDraftChanges = activeFile ? draft !== activeFile.content : false;

  const handleSave = useCallback(async () => {
    if (!rootPath || !selectedPath) return;
    setSaving(true);
    setFileError(null);
    try {
      await writeTrellisSpecFile(rootPath, selectedPath, draft);
      const saved = await readTrellisSpecFile(rootPath, selectedPath);
      setActiveFile(saved);
      setDraft(saved.content);
      setTree(await listTrellisSpecTree(rootPath));
      message.success("Spec 文件已保存");
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, message, rootPath, selectedPath]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Workspace 没有 Trellis rootPath" />;
  }

  return (
    <section className="project-trellis-spec">
      <div className="project-trellis-panel-head">
        <Typography.Text strong>Spec</Typography.Text>
        <Space size={6} wrap>
          <Tag>{areas.length} 个规范区</Tag>
          <Tag color="blue">{markdownCount} 个 Markdown</Tag>
          <Tag color={managedAreas === areas.length ? "success" : "warning"}>{managedAreas}/{areas.length} 入口就绪</Tag>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
            刷新
          </Button>
        </Space>
      </div>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading && tree.length === 0 ? (
        <div className="project-trellis-center__loading"><Spin size="small" /></div>
      ) : tree.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description=".trellis/spec 暂无规范目录" />
      ) : (
        <div className="project-trellis-spec__body">
          <div className="project-trellis-spec__tree" aria-label="Trellis spec 目录树">
            <Tree<TrellisSpecTreeDataNode>
              blockNode
              showIcon={false}
              defaultExpandAll
              selectedKeys={selectedPath ? [selectedPath] : []}
              treeData={treeData}
              onSelect={(_, info) => {
                const node = info.node as EventDataNode<TrellisSpecTreeDataNode>;
                if (node.specNode.nodeType === "file") {
                  setSelectedPath(node.specNode.relativePath);
                }
              }}
            />
          </div>
          <section className="project-trellis-spec__editor">
            <div className="project-trellis-spec__editor-head">
              <div>
                <Typography.Text strong>{activeFile?.relativePath ?? "选择一个 Markdown 规范"}</Typography.Text>
                <Typography.Text type="secondary">
                  {activeFile ? `${formatBytes(activeFile.sizeBytes)} · .trellis/spec/${activeFile.relativePath}` : "从左侧目录树打开文件"}
                </Typography.Text>
              </div>
              <Space size={6} wrap>
                {activeArea ? (
                  <Button
                    size="small"
                    icon={<FileDoneOutlined />}
                    onClick={() => {
                      if (project && onRequestSpecAgentUpdate && activeArea) {
                        void onRequestSpecAgentUpdate(project, activeArea);
                      }
                    }}
                  >
                    请求 Agent 更新
                  </Button>
                ) : null}
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!selectedPath || !hasDraftChanges || fileLoading}
                  onClick={handleSave}
                >
                  保存
                </Button>
              </Space>
            </div>
            {fileError ? <Alert type="error" showIcon message={fileError} /> : null}
            {fileLoading ? (
              <div className="project-trellis-center__loading"><Spin size="small" /></div>
            ) : activeFile ? (
              <Input.TextArea
                className="project-trellis-spec__markdown-editor"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoSize={false}
                spellCheck={false}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧 .md 文件后可直接编辑" />
            )}
          </section>
        </div>
      )}
      <div className="project-trellis-spec__footer">
        <Space size={6} wrap>
          {areas.slice(0, 6).map((area) => (
            <Tag key={area.area} color={area.hasIndex ? "success" : "warning"}>
              {area.area} · {area.mdFileCount}
            </Tag>
          ))}
          {areas.length > 6 ? <Tag>{areas.length - 6} 个更多规范区</Tag> : null}
        </Space>
        <Space size={6} wrap>
          {project && onOpenProjectSession ? (
            <Button size="small" onClick={() => onOpenProjectSession(project)}>
              回到主会话
            </Button>
          ) : null}
        </Space>
      </div>
    </section>
  );
}

function toSpecTreeDataNode(node: TrellisSpecTreeNode): TrellisSpecTreeDataNode {
  const isDirectory = node.nodeType === "directory";
  return {
    key: node.relativePath,
    specNode: node,
    title: (
      <span className="project-trellis-spec-tree-node">
        {isDirectory ? <FolderOpenOutlined /> : <FileMarkdownOutlined />}
        <span className="project-trellis-spec-tree-node__name">{node.name}</span>
      </span>
    ),
    selectable: !isDirectory,
    children: node.children.map(toSpecTreeDataNode),
  };
}

function findFirstSpecFile(nodes: TrellisSpecTreeNode[]): TrellisSpecTreeNode | null {
  for (const node of nodes) {
    if (node.nodeType === "file") return node;
    const child = findFirstSpecFile(node.children);
    if (child) return child;
  }
  return null;
}

function TrellisWorkflowMap({
  projectId,
  rootPath,
  enabled,
}: {
  projectId?: string | null;
  rootPath?: string | null;
  enabled: boolean;
}) {
  const [compiled, setCompiled] = useState<TrellisWorkflowCompiled | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!enabled || !rootPath) {
      setCompiled(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compileTrellisWorkflow({ projectId, rootPath })
      .then((next) => {
        if (!cancelled) setCompiled(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, rootPath]);

  useEffect(() => load(), [load]);

  const platformTags = useMemo(() => {
    const set = new Set<string>();
    for (const block of compiled?.platformBlocks ?? []) {
      for (const platform of block.platforms) {
        const normalized = platform.trim();
        if (normalized) set.add(normalized);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [compiled?.platformBlocks]);
  const transparencyStats = useMemo(() => {
    const required = compiled?.phases.reduce(
      (count, phase) => count + phase.steps.filter((step) => step.required).length,
      0,
    ) ?? 0;
    const steps = compiled?.phases.reduce((count, phase) => count + phase.steps.length, 0) ?? 0;
    return { required, steps };
  }, [compiled?.phases]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Workspace 没有 Trellis rootPath" />;
  }
  if (loading && !compiled) {
    return <div className="project-trellis-center__loading"><Spin size="small" /></div>;
  }
  if (error && !compiled) {
    return (
      <div className="project-trellis-center__empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无法读取 workflow.md" />
        <Typography.Paragraph type="secondary">{error}</Typography.Paragraph>
        <Button size="small" onClick={load}>重试</Button>
      </div>
    );
  }
  if (!compiled) return null;

  return (
    <section className="project-trellis-workflow">
      <div className="project-trellis-panel-head">
        <Typography.Text strong>运行图</Typography.Text>
        <Space size={6} wrap>
          <Tag>{transparencyStats.steps} steps</Tag>
          <Tag color={transparencyStats.required > 0 ? "red" : "default"}>{transparencyStats.required} required</Tag>
          <Tag color={compiled.validationIssues.length > 0 ? "warning" : "success"}>
            {compiled.validationIssues.length > 0 ? `${compiled.validationIssues.length} 个校验问题` : "校验通过"}
          </Tag>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
            刷新
          </Button>
        </Space>
      </div>
      {compiled.validationIssues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="workflow.md 有校验提示"
          description={compiled.validationIssues.map((issue) => issue.message).join("\n")}
        />
      ) : null}
      <div className="project-trellis-workflow__graph">
        <TrellisWorkflowDiagram compiled={compiled} />
      </div>
      {platformTags.length > 0 ? (
        <div className="project-trellis-workflow__platforms">
          <Typography.Text type="secondary">平台分支</Typography.Text>
          <Space size={4} wrap>
            {platformTags.map((platform) => (
              <Tag key={platform}>{platform}</Tag>
            ))}
          </Space>
        </div>
      ) : null}
      <Typography.Text className="project-trellis-workflow__path" type="secondary">
        {compiled.workflowPath}
      </Typography.Text>
    </section>
  );
}

function TrellisWorkflowDiagram({ compiled }: { compiled: TrellisWorkflowCompiled }) {
  const phaseStats = useMemo(() => {
    return Object.fromEntries(
      compiled.phases.map((phase) => [
        phase.id,
        {
          title: WORKFLOW_NODE_LABELS[phase.id] ?? phase.title,
          steps: phase.steps.length,
          required: phase.steps.filter((step) => step.required).length,
        },
      ]),
    ) as Record<string, { title: string; steps: number; required: number } | undefined>;
  }, [compiled.phases]);

  return (
    <div className="project-trellis-flow">
      <div className="project-trellis-flow__phasebar">
        {compiled.phases.map((phase) => {
          const stats = phaseStats[phase.id];
          return (
            <div key={phase.id} className="project-trellis-flow-phase">
              <strong>{stats?.title ?? phase.title}</strong>
              <span>{stats?.steps ?? phase.steps.length} 步</span>
              <span>{stats?.required ?? 0} 必做</span>
            </div>
          );
        })}
      </div>
      {TRELLIS_TRANSPARENCY_LANES.map((lane, index) => (
        <TrellisWorkflowLane
          key={lane.id}
          lane={lane}
          phaseStats={phaseStats}
          connector={index < TRELLIS_TRANSPARENCY_LANES.length - 1}
        />
      ))}
    </div>
  );
}

function TrellisWorkflowLane({
  lane,
  phaseStats,
  connector,
}: {
  lane: (typeof TRELLIS_TRANSPARENCY_LANES)[number];
  phaseStats: Record<string, { title: string; steps: number; required: number } | undefined>;
  connector: boolean;
}) {
  return (
    <>
      <section className="project-trellis-flow-lane">
        <div className="project-trellis-flow-lane__head">
          <Typography.Text strong>{lane.title}</Typography.Text>
        </div>
        <div className="project-trellis-flow-lane__track">
          {lane.nodes.map((node, index) => (
            <div key={node.id} className="project-trellis-flow-lane__step">
              <TrellisWorkflowCard node={node} phaseStats={phaseStats} />
              {index < lane.nodes.length - 1 ? (
                <span className="project-trellis-flow-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {connector ? (
        <div className="project-trellis-flow-connector" aria-hidden>
          <span>↓</span>
        </div>
      ) : null}
    </>
  );
}

function TrellisWorkflowCard({
  node,
  phaseStats,
}: {
  node: TrellisTransparencyNode;
  phaseStats: Record<string, { title: string; steps: number; required: number } | undefined>;
}) {
  const phase = node.phaseId ? phaseStats[node.phaseId] : null;
  return (
    <article className={node.id === "pretooluse" ? "project-trellis-flow-card project-trellis-flow-card--active" : "project-trellis-flow-card"}>
      <div className="project-trellis-flow-card__top">
        <div>
          <Typography.Text strong>{node.label}</Typography.Text>
          <span>{node.detail}</span>
        </div>
        {phase ? <Tag>{phase.title}</Tag> : <Tag>Runtime</Tag>}
      </div>
      <Typography.Paragraph className="project-trellis-flow-card__desc">
        {node.description}
      </Typography.Paragraph>
      <div className="project-trellis-flow-card__status">
        <span>{node.status}</span>
      </div>
      <div className="project-trellis-flow-card__files">
        {node.files.slice(0, 3).map((file) => (
          <Tag key={file}>{file}</Tag>
        ))}
      </div>
    </article>
  );
}

function TrellisRuntimeOverview({
  rootPath,
  onboarding,
  events,
  agentNodes,
  loading,
}: {
  rootPath?: string | null;
  onboarding: TrellisOnboardingState | null;
  events: TrellisRuntimeEvent[];
  agentNodes: TrellisAgentGraphNode[];
  loading: boolean;
}) {
  const [fallbackOnboarding, setFallbackOnboarding] = useState<TrellisOnboardingState | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (!rootPath || onboarding) return;
    let cancelled = false;
    setFallbackLoading(true);
    getTrellisOnboardingState({ rootPath })
      .then((next) => {
        if (!cancelled) setFallbackOnboarding(next);
      })
      .catch(() => {
        if (!cancelled) setFallbackOnboarding(null);
      })
      .finally(() => {
        if (!cancelled) setFallbackLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onboarding, rootPath]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Workspace 没有 Trellis rootPath" />;
  }

  const state = onboarding ?? fallbackOnboarding;
  const checks = state?.checks ?? [];
  const passCount = checks.filter((check) => check.status === "pass").length;
  const readyPercent = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0;
  const runningAgents = agentNodes.filter((node) => node.nodeType === "agent" && node.status === "running").length;
  const recentEvents = events.slice(0, 8);
  const isLoading = loading || fallbackLoading;

  return (
    <section className="project-trellis-runtime">
      <div className="project-trellis-runtime__hero">
        <div>
          <Typography.Text strong>运行证据总览</Typography.Text>
          <Typography.Paragraph type="secondary">
            这里展示 Trellis 是否能工作、最近是否有 Agent/Hook 事件，以及哪些运行证据可追溯。
          </Typography.Paragraph>
        </div>
        <Progress
          type="circle"
          percent={readyPercent}
          size={88}
          strokeColor={readyPercent === 100 ? "var(--mission-success)" : "var(--mission-warning)"}
          format={() => (state?.status === "ready" ? "就绪" : `${passCount}/${checks.length}`)}
        />
      </div>
      <div className="project-trellis-runtime__metrics">
        <RuntimeMetric icon={<CheckCircleOutlined />} label="健康检查" value={`${passCount}/${checks.length || 0}`} />
        <RuntimeMetric icon={<ApartmentOutlined />} label="活跃 Agent" value={String(runningAgents)} />
        <RuntimeMetric icon={<ThunderboltOutlined />} label="最近事件" value={String(events.length)} />
        <RuntimeMetric icon={<DatabaseOutlined />} label="证据根目录" value=".trellis/" />
      </div>
      {isLoading && !state ? (
        <div className="project-trellis-center__loading"><Spin size="small" /></div>
      ) : null}
      <div className="project-trellis-runtime__checks">
        {checks.map((check) => (
          <div key={check.id} className={`project-trellis-runtime-check project-trellis-runtime-check--${check.status}`}>
            <CheckCircleOutlined />
            <div>
              <Typography.Text strong>{CHECK_LABELS[check.id] ?? check.label}</Typography.Text>
              <Typography.Text type="secondary">{humanizeCheckDetail(check.detail)}</Typography.Text>
            </div>
            <Tag color={check.status === "pass" ? "success" : "error"}>
              {check.status === "pass" ? "通过" : "需处理"}
            </Tag>
          </div>
        ))}
      </div>
      <Collapse
        size="small"
        ghost
        items={[
          {
            key: "events",
            label: "查看最近 runtime events",
            children: recentEvents.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行事件" />
            ) : (
              <div className="project-trellis-runtime__event-list">
                {recentEvents.map((event) => (
                  <div key={event.eventId} className="project-trellis-runtime-event">
                    {eventIcon(event.eventKind)}
                    <div>
                      <Typography.Text strong>{eventKindLabel(event.eventKind)}</Typography.Text>
                      <Typography.Text type="secondary">
                        {formatRuntimeTime(event.createdAt)}
                        {event.actor ? ` · ${event.actor}` : ""}
                        {event.taskPath ? ` · ${event.taskPath.split("/").pop()}` : ""}
                      </Typography.Text>
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}

function RuntimeMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="project-trellis-runtime-metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function countSpecMarkdown(nodes: TrellisSpecTreeNode[]): number {
  return nodes.reduce((count, node) => (
    count + (node.nodeType === "file" ? 1 : countSpecMarkdown(node.children))
  ), 0);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function humanizeCheckDetail(detail: string): string {
  return detail.replace(/^Found\s+/i, "已找到 ");
}

function eventKindLabel(kind: string): string {
  if (kind.includes("hook")) return "Hook 注入";
  if (kind.includes("task.create")) return "创建任务";
  if (kind.includes("task.start")) return "开始任务";
  if (kind.includes("task.complete")) return "完成任务";
  if (kind.includes("agent.start")) return "Agent 启动";
  if (kind.includes("agent.complete")) return "Agent 完成";
  if (kind.includes("agent.heartbeat")) return "Agent 心跳";
  if (kind.includes("spec")) return "Spec 变更";
  return kind.replace(/^trellis\./, "");
}

function eventIcon(kind: string) {
  if (kind.includes("agent")) return <BranchesOutlined />;
  if (kind.includes("task")) return <PlayCircleOutlined />;
  if (kind.includes("hook")) return <ForkOutlined />;
  if (kind.includes("spec")) return <FileMarkdownOutlined />;
  return <CodeOutlined />;
}

function formatRuntimeTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value).toLocaleString("zh-CN");
}
