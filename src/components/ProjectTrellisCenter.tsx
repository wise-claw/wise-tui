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
import { Markdown } from "./ClaudeSessions/Markdown";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListTodo,
  Table,
  Code,
  Eye,
  Activity,
  Heart,
  Shield,
  FileCode,
  Flame,
  Layout,
  FileText,
  Clock,
  Terminal,
  Search,
  Plus,
  Trash2,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  Alert,
  App as AntApp,
  Button,
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
  Modal,
} from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from "react";
import type { ProjectItem, Repository } from "../types";
import { useTrellisRuntime } from "../hooks/useTrellisRuntime";
import {
  compileTrellisWorkflow,
  getTrellisOnboardingState,
  recordTrellisSpecRevision,
  type TrellisAgentGraphNode,
  type TrellisOnboardingCheck,
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

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("spec");
  const handleReturnToMainSession = useCallback(() => {
    if (project && onOpenProjectSession) {
      void onOpenProjectSession(project);
      return;
    }
    onClose?.();
  }, [onClose, onOpenProjectSession, project]);

  const centerClassName = inline
    ? "project-trellis-center project-trellis-center--compact"
    : "project-trellis-center";

  const content = (
    <div className={centerClassName}>
      <div className="project-trellis-center__toolbar" aria-label="Trellis 工作区状态">
        <div className="project-trellis-center__toolbar-main">
          <Tag className="project-trellis-center__tag" color={rootPath ? "success" : "warning"}>
            {rootPath ? "根目录就绪" : "未绑定根目录"}
          </Tag>
          <Tag className="project-trellis-center__tag">{sddModeLabel}</Tag>
          {rootPath ? (
            <Typography.Text className="project-trellis-center__root" title={rootPath}>
              {rootPath}
            </Typography.Text>
          ) : null}
        </div>
        <Button
          type="primary"
          ghost
          size={inline ? "small" : "middle"}
          className="project-trellis-center__session-btn"
          icon={<ExternalLink size={inline ? 12 : 13} />}
          disabled={!project && !onClose}
          onClick={handleReturnToMainSession}
        >
          回到主会话
        </Button>
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
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "spec",
            label: "规范库",
            children: (
              <TrellisSpecTreePanel
                rootPath={rootPath}
                enabled={open}
                project={project}
                selectedPath={selectedPath}
                setSelectedPath={setSelectedPath}
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
                onJumpToSpec={(nodeId) => {
                  let targetPath = "guides/index.md";
                  if (nodeId === "spec-scope") targetPath = "guides/agent-harness-architecture.md";
                  else if (nodeId === "task-artifacts") targetPath = "guides/trellis-splitter-prompt.md";
                  else if (nodeId === "research") targetPath = "guides/code-reuse-thinking-guide.md";
                  else if (nodeId === "journal") targetPath = "guides/commit-hygiene.md";
                  else if (nodeId === "update-spec") targetPath = "guides/index.md";

                  setSelectedPath(targetPath);
                  setActiveTab("spec");
                }}
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
  selectedPath: string | null;
  setSelectedPath: Dispatch<SetStateAction<string | null>>;
  onRequestSpecAgentUpdate?: (project: ProjectItem, area: string) => void | Promise<void>;
}

interface TrellisSpecTreeDataNode extends DataNode {
  specNode: TrellisSpecTreeNode;
  children?: TrellisSpecTreeDataNode[];
}

function filterSpecTree(nodes: TrellisSpecTreeNode[], query: string): TrellisSpecTreeNode[] {
  if (!query) return nodes;
  const lowerQuery = query.toLowerCase();
  return nodes
    .map((node) => {
      if (node.nodeType === "file") {
        return node.name.toLowerCase().includes(lowerQuery) ? node : null;
      }
      const filteredChildren = filterSpecTree(node.children, query);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerQuery)) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    })
    .filter(Boolean) as TrellisSpecTreeNode[];
}

function TrellisSpecTreePanel({
  rootPath,
  enabled,
  project,
  selectedPath,
  setSelectedPath,
  onRequestSpecAgentUpdate,
}: TrellisSpecTreePanelProps) {
  const { message } = AntApp.useApp();
  const [areas, setAreas] = useState<TrellisSpecArea[]>([]);
  const [tree, setTree] = useState<TrellisSpecTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<TrellisSpecFile | null>(null);
  const [draft, setDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "diff">("edit");

  const [searchQuery, setSearchQuery] = useState("");
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [isNewSpecModalOpen, setIsNewSpecModalOpen] = useState(false);
  const [newSpecName, setNewSpecName] = useState("");
  const [newSpecArea, setNewSpecArea] = useState("guides");

  useEffect(() => {
    if (!selectedPath && tree.length > 0) {
      setSelectedPath(findFirstSpecFile(tree)?.relativePath ?? null);
    }
  }, [tree, selectedPath, setSelectedPath]);

  useEffect(() => {
    setViewMode("edit");
  }, [selectedPath]);

  const insertMarkdown = useCallback((syntax: string) => {
    const textarea = document.querySelector(".project-trellis-spec__markdown-editor") as HTMLTextAreaElement;
    if (!textarea) {
      setDraft((current) => current + "\n" + syntax);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = textarea.value.substring(start, end);

    let replacement = syntax;
    if (syntax === "bold") {
      replacement = `**${selection || "加粗文字"}**`;
    } else if (syntax === "italic") {
      replacement = `*${selection || "斜体文字"}*`;
    } else if (syntax === "h1") {
      replacement = `\n# ${selection || "一级标题"}\n`;
    } else if (syntax === "h2") {
      replacement = `\n## ${selection || "二级标题"}\n`;
    } else if (syntax === "h3") {
      replacement = `\n### ${selection || "三级标题"}\n`;
    } else if (syntax === "list") {
      replacement = `\n- ${selection || "列表项"}\n`;
    } else if (syntax === "todo") {
      replacement = `\n- [ ] ${selection || "待办事项"}\n`;
    } else if (syntax === "code") {
      replacement = `\n\`\`\`typescript\n${selection || "// 代码示例"}\n\`\`\`\n`;
    } else if (syntax === "table") {
      replacement = `\n| 表头 1 | 表头 2 |\n| ------ | ------ |\n| 内容 1 | 内容 2 |\n`;
    }

    const newVal = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    setDraft(newVal);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 0);
  }, []);

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

  // Filtered Tree & treeData mapping
  const filteredTree = useMemo(() => filterSpecTree(tree, searchQuery), [tree, searchQuery]);
  const treeData = useMemo(() => filteredTree.map(toSpecTreeDataNode), [filteredTree]);

  const activeArea = selectedPath?.split("/")[0] ?? null;
  const hasDraftChanges = activeFile ? draft !== activeFile.content : false;
  const canSaveDraft = Boolean(selectedPath && hasDraftChanges && !fileLoading && !saving);

  const handleSave = useCallback(async () => {
    if (!rootPath || !selectedPath || !hasDraftChanges || fileLoading || saving) return;
    setSaving(true);
    setFileError(null);
    try {
      await writeTrellisSpecFile(rootPath, selectedPath, draft);
      const saved = await readTrellisSpecFile(rootPath, selectedPath);
      await recordTrellisSpecRevision({
        projectId: project?.id ?? null,
        rootPath,
        filePath: `.trellis/spec/${saved.relativePath}`,
        content: saved.content,
        author: "wise",
        reason: "edited_from_trellis_spec_center",
        source: "project_trellis_center",
      }).catch(() => null);
      setActiveFile(saved);
      setDraft(saved.content);
      setTree(await listTrellisSpecTree(rootPath));
      message.success("Spec 文件已保存");
      setViewMode("edit");
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, fileLoading, hasDraftChanges, message, project?.id, rootPath, saving, selectedPath]);

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSaveDraft) void handleSave();
      }
    },
    [canSaveDraft, handleSave],
  );

  const handleCreateSpec = useCallback(async () => {
    if (!newSpecName || !rootPath) return;
    const trimmedName = newSpecName.trim();
    const fileName = trimmedName.endsWith(".md") ? trimmedName : `${trimmedName}.md`;
    const targetFolder = newSpecArea.trim() || "guides";
    const relativePath = `${targetFolder}/${fileName}`;
    setSaving(true);
    try {
      const initialContent = `# ${trimmedName.replace(/\.md$/, "")}\n\n## Scope\n\n## Guidelines\n\n`;
      await writeTrellisSpecFile(rootPath, relativePath, initialContent);
      await recordTrellisSpecRevision({
        projectId: project?.id ?? null,
        rootPath,
        filePath: `.trellis/spec/${relativePath}`,
        content: initialContent,
        author: "wise",
        reason: "created_from_trellis_spec_center",
        source: "project_trellis_center",
      }).catch(() => null);
      setTree(await listTrellisSpecTree(rootPath));
      setSelectedPath(relativePath);
      setIsNewSpecModalOpen(false);
      setNewSpecName("");
      message.success(`成功创建规约: ${relativePath}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [message, newSpecArea, newSpecName, project?.id, rootPath, setSelectedPath]);

  const handleDeleteSpec = useCallback(() => {
    if (!selectedPath) return;
    Modal.info({
      title: "暂不支持在 Wise 内删除规范文件",
      content: (
        <Typography.Paragraph>
          为避免误删 `.trellis/spec/{selectedPath}`，当前页面只提供新增、编辑、预览和保存。需要删除时请在仓库中完成后点击刷新。
        </Typography.Paragraph>
      ),
      okText: "知道了",
    });
  }, [selectedPath]);

  const handleAgentReview = useCallback(async () => {
    if (!project || !onRequestSpecAgentUpdate || !activeArea) {
      message.info("当前没有可用的规约补全入口");
      return;
    }
    setAiOptimizing(true);
    try {
      await onRequestSpecAgentUpdate(project, activeArea);
      message.success("已请求 Agent 补全当前规约区");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAiOptimizing(false);
    }
  }, [activeArea, message, onRequestSpecAgentUpdate, project]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Workspace 没有 Trellis rootPath" />;
  }

  return (
    <section className="project-trellis-spec">
      <div className="project-trellis-panel-head">
        <div className="project-trellis-panel-title">
          <Typography.Text strong>Spec 填写引导中心</Typography.Text>
          <Typography.Text type="secondary">
            初始化任务 00-bootstrap-guidelines 会引导团队补齐这些规约模板
          </Typography.Text>
        </div>
        <Space size={6} wrap>
          <Tag color="purple">初始化任务：00-bootstrap-guidelines</Tag>
          <Tag color="blue">待补全：{markdownCount} 篇规约</Tag>
          <Tag color={managedAreas === areas.length ? "success" : "warning"}>入口检查：{managedAreas}/{areas.length} 就绪</Tag>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load} title="刷新规约库" />
        </Space>
      </div>
      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="project-trellis-spec__body">
        <div className="project-trellis-spec__sidebar">
          <Input
            placeholder="搜索规约文档..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            prefix={<Search size={13} style={{ color: "var(--mission-muted)", marginRight: 4 }} />}
            style={{ width: "100%" }}
          />
          <div className="project-trellis-spec__tree-actions">
            <Button
              size="small"
              icon={<Plus size={12} />}
              type="dashed"
              onClick={() => setIsNewSpecModalOpen(true)}
            >
              新建规约
            </Button>
            <Button
              size="small"
              danger
              disabled={!selectedPath}
              icon={<Trash2 size={12} />}
              onClick={handleDeleteSpec}
              title="删除规约"
            />
          </div>
          <div className="project-trellis-spec__tree project-trellis-spec__tree-shell" aria-label="Trellis spec 目录树">
            {treeData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配规约文档" style={{ marginTop: 16 }} />
            ) : (
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
            )}
          </div>
        </div>

        <section className="project-trellis-spec__editor">
          <div className="project-trellis-spec__editor-head">
            <div className="project-trellis-spec__editor-title">
              <Typography.Text strong>{activeFile?.relativePath ?? "选择一个 Markdown 规范"}</Typography.Text>
              <Typography.Text type="secondary" style={{ display: "block" }}>
                {activeFile ? `${formatBytes(activeFile.sizeBytes)} · .trellis/spec/${activeFile.relativePath}` : "从左侧目录树打开文件以进行配置"}
              </Typography.Text>
            </div>
            <div className="project-trellis-spec__editor-actions">
              {activeFile ? (
                <Space.Compact size="small">
                  <Button
                    type={viewMode === "preview" ? "primary" : "default"}
                    icon={<Eye size={13} />}
                    onClick={() => setViewMode(viewMode === "preview" ? "edit" : "preview")}
                  >
                    预览
                  </Button>
                  <Button
                    type={viewMode === "diff" ? "primary" : "default"}
                    icon={<FileCode size={13} />}
                    onClick={() => setViewMode(viewMode === "diff" ? "edit" : "diff")}
                  >
                    查看改动
                  </Button>
                </Space.Compact>
              ) : null}
              {activeFile ? (
                <div className="project-trellis-spec__editor-divider" />
              ) : null}
              {activeArea ? (
                <Button
                  size="small"
                  className="project-trellis-spec__ai-btn"
                  icon={<Sparkles size={12} />}
                  disabled={!onRequestSpecAgentUpdate}
                  loading={aiOptimizing}
                  onClick={handleAgentReview}
                >
                  让 Agent 补全规约
                </Button>
              ) : null}
            </div>
          </div>
          {fileError ? <Alert type="error" showIcon message={fileError} /> : null}

          {fileLoading ? (
            <div className="project-trellis-center__loading"><Spin size="small" /></div>
          ) : activeFile ? (
            viewMode === "diff" ? (
              <div className="project-trellis-spec__diff-container">
                <div className="project-trellis-spec__diff-column">
                  <div className="project-trellis-spec__diff-head">
                    <span>原始规约 (.trellis/spec)</span>
                    <Tag color="default">READ-ONLY</Tag>
                  </div>
                  <pre className="project-trellis-spec__diff-content project-trellis-spec__diff-content--base">
                    {activeFile?.content}
                  </pre>
                </div>
                <div className="project-trellis-spec__diff-column">
                  <div className="project-trellis-spec__diff-head">
                    <span>待保存草稿 (Draft Changes)</span>
                    <Tag color="warning">MODIFIED</Tag>
                  </div>
                  <pre className="project-trellis-spec__diff-content project-trellis-spec__diff-content--draft">
                    {draft}
                  </pre>
                </div>
              </div>
            ) : viewMode === "edit" ? (
              <div className="project-trellis-spec__editor-container">
                <div className="project-trellis-spec__markdown-toolbar">
                  <div className="project-trellis-spec__markdown-toolbar-groups">
                    <Button type="text" size="small" onClick={() => insertMarkdown("h1")} title="一级标题"><Heading1 size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("h2")} title="二级标题"><Heading2 size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("h3")} title="三级标题"><Heading3 size={13} /></Button>
                    <div className="project-trellis-spec__toolbar-divider" />
                    <Button type="text" size="small" onClick={() => insertMarkdown("bold")} title="加粗"><Bold size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("italic")} title="斜体"><Italic size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("code")} title="代码块"><Code size={13} /></Button>
                    <div className="project-trellis-spec__toolbar-divider" />
                    <Button type="text" size="small" onClick={() => insertMarkdown("list")} title="无序列表"><List size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("todo")} title="待办事项"><ListTodo size={13} /></Button>
                    <Button type="text" size="small" onClick={() => insertMarkdown("table")} title="插入表格"><Table size={13} /></Button>
                  </div>
                </div>
                <Input.TextArea
                  className="project-trellis-spec__markdown-editor"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  autoSize={false}
                  spellCheck={false}
                  style={{ flex: 1, minHeight: 0 }}
                />
                <div className="project-trellis-spec__ai-copilot">
                  <span className="project-trellis-spec__ai-copilot-pulse" />
                  <span className="project-trellis-spec__ai-copilot-text">
                    <strong>00-bootstrap-guidelines</strong>：可让 Agent 根据项目现状补全当前规约区；Wise 不会自动改写草稿。
                  </span>
                </div>
              </div>
            ) : (
              <div className="project-trellis-spec__preview-container" style={{ flex: 1, overflowY: "auto" }}>
                <Markdown text={draft} className="project-trellis-spec__preview-render" />
              </div>
            )
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在左侧选择或新建一个 .md 规约文件后可直接编辑/预览" />
          )}
        </section>
      </div>

      {/* New Spec File Creator Modal */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} style={{ color: "var(--mission-accent)" }} />
            <span>新建 Trellis 规约文件</span>
          </div>
        }
        open={isNewSpecModalOpen}
        onCancel={() => setIsNewSpecModalOpen(false)}
        onOk={handleCreateSpec}
        okButtonProps={{ disabled: !newSpecName }}
        okText="确认创建"
        cancelText="取消"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 5 }}>规范文件名:</div>
            <Input
              placeholder="e.g. coding-guidelines.md"
              value={newSpecName}
              onChange={(e) => setNewSpecName(e.target.value)}
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 5 }}>存放分区目录:</div>
            <Input
              placeholder="guides (默认)"
              value={newSpecArea}
              onChange={(e) => setNewSpecArea(e.target.value)}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: 0 }}>
            规约文件会保存到 `.trellis/spec/[分区]/[文件名].md`。后续开发会在读取 Trellis spec 时使用这些内容。
          </Typography.Paragraph>
        </div>
      </Modal>
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
  onJumpToSpec,
}: {
  projectId?: string | null;
  rootPath?: string | null;
  enabled: boolean;
  onJumpToSpec: (nodeId: string) => void;
}) {
  const [compiled, setCompiled] = useState<TrellisWorkflowCompiled | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("pretooluse");

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

  const transparencyStats = useMemo(() => {
    const required = compiled?.phases.reduce(
      (count, phase) => count + phase.steps.filter((step) => step.required).length,
      0,
    ) ?? 0;
    const steps = compiled?.phases.reduce((count, phase) => count + phase.steps.length, 0) ?? 0;
    return { required, steps };
  }, [compiled?.phases]);

  const phaseStats = useMemo(() => {
    if (!compiled) return {};
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
  }, [compiled?.phases]);

  const selectedNode = useMemo(() => {
    return TRELLIS_TRANSPARENCY_NODES.find((node) => node.id === selectedNodeId) || TRELLIS_TRANSPARENCY_NODES[0];
  }, [selectedNodeId]);

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
        <Typography.Text strong>工作流结构</Typography.Text>
        <Space size={6} wrap>
          <Tag>{transparencyStats.steps} 运行步骤</Tag>
          <Tag color={transparencyStats.required > 0 ? "red" : "default"}>{transparencyStats.required} 必做步骤</Tag>
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
          className="project-trellis-workflow__alert project-trellis-workflow__alert--compact"
          message={
            <span
              className="project-trellis-workflow__alert-line"
              title={compiled.validationIssues.map((issue) => issue.message).join("\n")}
            >
              <span className="project-trellis-workflow__alert-label">workflow.md</span>
              {compiled.validationIssues.map((issue) => issue.message).join(" · ")}
            </span>
          }
        />
      ) : null}

      <div className="project-trellis-workflow__graph-layout">
        <div className="project-trellis-workflow__graph-canvas">
          <TrellisWorkflowDiagram
            compiled={compiled}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            activeNodeId={null}
          />
        </div>
        <div className="project-trellis-workflow__inspector-panel">
          <TrellisNodeInspector
            node={selectedNode}
            phaseStats={phaseStats}
            onJumpToSpec={onJumpToSpec}
          />
        </div>
      </div>

      <Typography.Text className="project-trellis-workflow__path" type="secondary">
        {compiled.workflowPath}
      </Typography.Text>
    </section>
  );
}

function TrellisNodeInspector({
  node,
  phaseStats,
  onJumpToSpec,
}: {
  node: TrellisTransparencyNode;
  phaseStats: Record<string, { title: string; steps: number; required: number } | undefined>;
  onJumpToSpec: (nodeId: string) => void;
}) {
  const phase = node.phaseId ? phaseStats[node.phaseId] : null;
  const isDocNode = ["task-artifacts", "context-jsonl", "journal"].includes(node.id);
  const isGateNode = ["workflow-state", "finish-check", "break-loop"].includes(node.id);
  const icon = getNodeIcon(node);

  return (
    <article className="project-trellis-inspector">
      <div className="project-trellis-inspector__head">
        <div className="project-trellis-inspector__title-row">
          <span className="project-trellis-inspector__icon">{icon}</span>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }} className="project-trellis-inspector__title">
              {node.label}
            </Typography.Title>
            <span className="project-trellis-inspector__subtitle">{node.detail}</span>
          </div>
        </div>
        <div className="project-trellis-inspector__badges">
          {phase ? (
            <Tag color="purple">{phase.title}</Tag>
          ) : (
            <Tag color="cyan">运行时环境</Tag>
          )}
          {isDocNode && <Tag color="blue">数据产出</Tag>}
          {isGateNode && <Tag color="warning">工作校验关卡</Tag>}
        </div>
      </div>

      <div className="project-trellis-inspector__divider" />

      <div className="project-trellis-inspector__section">
        <div className="project-trellis-inspector__section-title">流程描述 (中文)</div>
        <Typography.Paragraph className="project-trellis-inspector__desc">
          {node.description}
        </Typography.Paragraph>
      </div>

      <div className="project-trellis-inspector__section">
        <div className="project-trellis-inspector__section-title">状态变量 / 环境变量</div>
        <div className="project-trellis-inspector__terminal">
          <div className="project-trellis-inspector__terminal-line">
            <span className="project-trellis-inspector__terminal-prompt">$</span>
            <span className="project-trellis-inspector__terminal-val">{node.status}</span>
          </div>
        </div>
      </div>

      <div className="project-trellis-inspector__section">
        <div className="project-trellis-inspector__section-title">关联证据与文件路径</div>
        <div className="project-trellis-inspector__files">
          {node.files.map((file) => (
            <div key={file} className="project-trellis-inspector-file-row">
              <span className="project-trellis-inspector-file-row__icon"><FileMarkdownOutlined /></span>
              <span className="project-trellis-inspector-file-row__name" title={file}>
                {file}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="project-trellis-inspector__actions">
        <Button
          size="small"
          icon={<ExternalLink size={11} />}
          onClick={() => onJumpToSpec(node.id)}
        >
          打开关联规约
        </Button>
      </div>
    </article>
  );
}

function TrellisWorkflowDiagram({
  compiled,
  selectedNodeId,
  onSelectNode,
  activeNodeId,
}: {
  compiled: TrellisWorkflowCompiled;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  activeNodeId: string | null;
}) {
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
      <div className="project-trellis-flow__columns">
        {TRELLIS_TRANSPARENCY_LANES.map((lane, index) => (
          <TrellisWorkflowLane
            key={lane.id}
            lane={lane}
            connector={index < TRELLIS_TRANSPARENCY_LANES.length - 1}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            activeNodeId={activeNodeId}
          />
        ))}
      </div>
    </div>
  );
}

function TrellisWorkflowLane({
  lane,
  connector,
  selectedNodeId,
  onSelectNode,
  activeNodeId,
}: {
  lane: (typeof TRELLIS_TRANSPARENCY_LANES)[number];
  connector: boolean;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  activeNodeId: string | null;
}) {
  return (
    <div className={`project-trellis-flow-column project-trellis-flow-column--${lane.id}`}>
      <div className="project-trellis-flow-column__head">
        <Typography.Text strong>{lane.title}</Typography.Text>
      </div>
      <div className="project-trellis-flow-column__track">
        {lane.nodes.map((node, index) => (
          <div key={node.id} className="project-trellis-flow-node-wrapper">
            <TrellisWorkflowNode
              node={node}
              selected={node.id === selectedNodeId}
              active={node.id === activeNodeId}
              onClick={() => onSelectNode(node.id)}
            />
            {index < lane.nodes.length - 1 ? (
              <div className="project-trellis-flow-vertical-arrow" aria-hidden>
                <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
                  <path d="M8 0V22M8 22L3 17M8 22L13 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {connector ? (
        <div className="project-trellis-flow-bridge-arrow" aria-hidden>
          <svg width="32" height="16" viewBox="0 0 32 16" fill="none">
            <path d="M0 8H30M30 8L23 1M30 8L23 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      ) : null}
    </div>
  );
}

function TrellisWorkflowNode({
  node,
  selected,
  active,
  onClick,
}: {
  node: TrellisTransparencyNode;
  selected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const shapeClass = getNodeShapeClass(node);
  const icon = getNodeIcon(node);

  return (
    <div
      className={`project-trellis-flow-node ${selected ? "project-trellis-flow-node--selected" : ""} ${active ? "project-trellis-flow-node--active" : ""}`}
      onClick={onClick}
      title={`点击查看 ${node.label} 详情`}
    >
      <div className="project-trellis-flow-node__inner">
        <div className={`project-trellis-flow-node__icon-container project-trellis-flow-node__icon-container--${shapeClass}`}>
          <div className="project-trellis-flow-node__icon">{icon}</div>
        </div>
        <div className="project-trellis-flow-node__content">
          <span className="project-trellis-flow-node__label">{node.label}</span>
          <span className="project-trellis-flow-node__detail">{node.detail}</span>
        </div>
        {active ? (
          <span className="project-trellis-flow-node__beacon" />
        ) : null}
      </div>
      <div className="project-trellis-flow-node__socket project-trellis-flow-node__socket--top" />
      <div className="project-trellis-flow-node__socket project-trellis-flow-node__socket--bottom" />
    </div>
  );
}

function getNodeShapeClass(node: TrellisTransparencyNode): string {
  if (node.id === "session-start") return "circle";
  if (node.id === "archive") return "circle-end";
  if (["workflow-state", "finish-check", "break-loop"].includes(node.id)) return "diamond";
  if (["task-artifacts", "context-jsonl", "journal"].includes(node.id)) return "data";
  if (["pretooluse", "subagents"].includes(node.id)) return "hexagon";
  return "capsule";
}

function getNodeIcon(node: TrellisTransparencyNode) {
  switch (node.id) {
    case "session-start":
      return <PlayCircleOutlined />;
    case "archive":
      return <CheckCircleOutlined />;
    case "workflow-state":
      return <BranchesOutlined />;
    case "finish-check":
      return <FileDoneOutlined />;
    case "break-loop":
      return <ReloadOutlined />;
    case "task-artifacts":
      return <FolderOpenOutlined />;
    case "context-jsonl":
      return <DatabaseOutlined />;
    case "journal":
      return <FileMarkdownOutlined />;
    case "pretooluse":
      return <ThunderboltOutlined />;
    case "subagents":
      return <ApartmentOutlined />;
    case "current-state":
      return <CodeOutlined />;
    case "spec-scope":
      return <BranchesOutlined />;
    case "task-create":
      return <SaveOutlined />;
    case "research":
      return <FileMarkdownOutlined />;
    case "task-start":
      return <PlayCircleOutlined />;
    case "prompt-patch":
      return <ForkOutlined />;
    case "update-spec":
      return <ReloadOutlined />;
    case "commit":
      return <CheckCircleOutlined />;
    default:
      return <CodeOutlined />;
  }
}

function getCheckIcon(id: string) {
  switch (id) {
    case "trellis_dir":
      return <Shield size={16} className="project-trellis-check-icon project-trellis-check-icon--dir" />;
    case "task_py":
      return <FileCode size={16} className="project-trellis-check-icon project-trellis-check-icon--code" />;
    case "workflow":
      return <Layout size={16} className="project-trellis-check-icon project-trellis-check-icon--workflow" />;
    case "spec":
      return <FileText size={16} className="project-trellis-check-icon project-trellis-check-icon--spec" />;
    case "developer_identity":
      return <Heart size={16} className="project-trellis-check-icon project-trellis-check-icon--identity" />;
    case "codex_hooks":
      return <Flame size={16} className="project-trellis-check-icon project-trellis-check-icon--codex" />;
    case "claude_hooks":
      return <Activity size={16} className="project-trellis-check-icon project-trellis-check-icon--claude" />;
    case "task_workspace":
      return <Clock size={16} className="project-trellis-check-icon project-trellis-check-icon--workspace" />;
    default:
      return <Terminal size={16} className="project-trellis-check-icon" />;
  }
}

function formatRuntimeTimeShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function getEventClassSuffix(kind: string): string {
  if (kind.includes("agent")) return "agent";
  if (kind.includes("task")) return "task";
  if (kind.includes("hook")) return "hook";
  if (kind.includes("spec")) return "spec";
  return "default";
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
  const { message } = AntApp.useApp();
  const [refreshedOnboarding, setRefreshedOnboarding] = useState<TrellisOnboardingState | null>(null);
  const [fallbackOnboarding, setFallbackOnboarding] = useState<TrellisOnboardingState | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  const [isTroubleshootModalOpen, setIsTroubleshootModalOpen] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState<TrellisOnboardingCheck | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<TrellisRuntimeEvent[]>(events);

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

  useEffect(() => {
    setRefreshedOnboarding(null);
  }, [rootPath]);

  const state = refreshedOnboarding ?? onboarding ?? fallbackOnboarding;
  const checks = state?.checks ?? [];

  useEffect(() => {
    setVisibleEvents(events);
  }, [events]);

  if (!rootPath) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Workspace 没有 Trellis rootPath" />;
  }

  const passCount = checks.filter((check) => check.status === "pass").length;
  const readyPercent = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0;
  const runningAgents = agentNodes.filter((node) => node.nodeType === "agent" && node.status === "running").length;
  const recentEvents = visibleEvents.slice(0, 8);
  const isLoading = loading || fallbackLoading;

  const handleRecheck = () => {
    if (!rootPath) return;
    setFallbackLoading(true);
    getTrellisOnboardingState({ rootPath })
      .then((next) => {
        setRefreshedOnboarding(next);
        message.success("已刷新 Trellis 自检结果");
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setFallbackLoading(false);
      });
  };

  const handleCheckCardClick = (check: TrellisOnboardingCheck) => {
    setSelectedCheck(check);
    setIsTroubleshootModalOpen(true);
  };

  const handleClearLogs = () => {
    setVisibleEvents([]);
    message.success("已清空当前视图中的事件列表");
  };

  const getTroubleGuide = (id: string) => {
    switch (id) {
      case "trellis_dir":
        return {
          desc: "Trellis 核心元数据目录审计",
          reason: "Trellis 自动化主干的元数据文件夹 `.trellis` 丢失，或 `.trellis/spec` 写入权限不足，阻碍规范库实时读取。",
          step: "1. 检查项目根目录下是否存在 `.trellis` 文件夹；\n2. 确认当前终端进程及 IDE 拥有此文件夹的读取与写入权限；\n3. 需要初始化时，在主会话中请求 Trellis bootstrap 或手动运行项目脚本。"
        };
      case "task_py":
        return {
          desc: "Trellis 任务引擎生命周期配置",
          reason: "自动化任务生命周期脚本 `.trellis/scripts/task.py` 未被激活，或者本地 Python 环境中缺少 runtime 依赖。",
          step: "1. 检查 `.trellis/scripts/task.py` 脚本是否存在；\n2. 运行 `python3 ./.trellis/scripts/task.py --help` 验证脚本可用；\n3. 如权限异常，再补充执行权限或检查 Python 环境。"
        };
      case "workflow":
        return {
          desc: "工作流声明描述文件 (workflow.md)",
          reason: "主工作流说明文档 `workflow.md` 语法解析失败，或定义的 Phase 步骤缺失必填字段，导致无法生成静态图。",
          step: "1. 打开并查看 `.trellis/workflow.md` 中是否存在 Markdown 格式嵌套混乱；\n2. 确认每个 Phase 中步骤的 `id` 与 `title` 完整；\n3. 修改后点击本页刷新，重新读取工作流校验结果。"
        };
      case "spec":
        return {
          desc: "规范层与包作用域关联配置",
          reason: "没有定义包级 spec 子目录，或主入口文件 `index.md` 结构错误，导致主会话无法精确裁切及注入开发规范。",
          step: "1. 检查 `.trellis/spec/` 目录结构；\n2. 确保每个分区中至少存在一个有效的 Markdown 入口；\n3. 可在规范库页新建或编辑对应规约文件。"
        };
      case "developer_identity":
        return {
          desc: "Trellis 开发者身份标识",
          reason: "开发者身份文件未初始化，无法追溯会话日志和任务记录。",
          step: "1. 确认 `.trellis/.developer` 或 `.trellis/workspace/` 下的身份信息是否存在；\n2. 需要初始化时运行 `python3 ./.trellis/scripts/init_developer.py <name>`；\n3. 刷新本页确认自检状态。"
        };
      case "codex_hooks":
        return {
          desc: "Codex IDE 钩子注册",
          reason: "IDE 钩子未被正确激活，可能导致 Trellis 状态无法注入到会话。",
          step: "1. 验证 `.codex/config.toml` 与对应 hook 脚本是否存在；\n2. 检查本机 Codex 配置是否读取项目配置；\n3. 修改配置后重新打开会话。"
        };
      case "claude_hooks":
        return {
          desc: "Claude 代理上下文注入机制",
          reason: "上下文合并规则或注入脚本错误，导致 Spec 库无法与主会话自动绑定，提示词无法正确补齐。",
          step: "1. 验证 `.claude/hooks/inject-workflow-state.py` 脚本；\n2. 确认 Claude Code 已读取项目级 hook 配置；\n3. 修改后重新进入会话并刷新本页。"
        };
      case "task_workspace":
        return {
          desc: "当前活跃开发任务状态追踪",
          reason: "当前工作区缺少活跃的 `active_task.json` 索引，系统无法判断开发进度或当前任务生命周期状态。",
          step: "1. 确认 `.trellis/tasks/` 目录下有进行中的任务；\n2. 使用 `python3 ./.trellis/scripts/task.py current --source` 查看当前任务；\n3. 需要切换时使用 `task.py start <task>`。"
        };
      default:
        return {
          desc: "系统级核心服务就绪审计",
          reason: "未知系统变量缺失或环境依赖中断。",
          step: "1. 查看运行事件日志；\n2. 使用终端命令行尝试手动跑自检流程；\n3. 重新打开工作区后刷新本页。"
        };
    }
  };

  return (
    <section className="project-trellis-runtime">
      <div className="project-trellis-runtime__hero">
        <div className="project-trellis-runtime__hero-copy">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 16 }}>运行证据与健康检查</Typography.Text>
            <Space size={6}>
              <Button
                type="primary"
                size="small"
                icon={<ReloadOutlined />}
                loading={isLoading}
                onClick={handleRecheck}
              >
                刷新检查
              </Button>
            </Space>
          </div>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            本页只呈现 Trellis 后端实际读取到的运行状态、健康检查和事件记录。
          </Typography.Paragraph>
        </div>
        <Progress
          type="circle"
          percent={readyPercent}
          size={88}
          strokeColor={readyPercent === 100 ? "var(--mission-success)" : "var(--mission-warning)"}
          format={() => readyPercent === 100 ? "系统就绪" : `${passCount}/${checks.length}`}
        />
      </div>

      <div className="project-trellis-runtime__metrics">
        <RuntimeMetric icon={<Activity size={20} />} label="健康检查" value={`${passCount}/${checks.length || 0}`} />
        <RuntimeMetric icon={<Terminal size={20} />} label="活跃 Agent 任务" value={String(runningAgents)} />
        <RuntimeMetric icon={<Flame size={20} />} label="系统事件数" value={String(events.length)} />
        <RuntimeMetric icon={<Shield size={20} />} label="证据根目录" value=".trellis/" />
      </div>

      {isLoading && !state ? (
        <div className="project-trellis-center__loading"><Spin size="small" /></div>
      ) : null}

      <div className="project-trellis-runtime__checks-container">
        <div className="project-trellis-runtime__section-title">健康检查项</div>
        <div className="project-trellis-runtime__checks">
          {checks.map((check) => (
            <div
              key={check.id}
              className={`project-trellis-runtime-check project-trellis-runtime-check--${check.status}`}
              onClick={() => handleCheckCardClick(check)}
              style={{ cursor: "pointer", transition: "all 0.2s" }}
            >
              <div className="project-trellis-runtime-check__icon-wrap">
                {getCheckIcon(check.id)}
              </div>
              <div className="project-trellis-runtime-check__content">
                <Typography.Text strong>{CHECK_LABELS[check.id] ?? check.label}</Typography.Text>
                <Typography.Text type="secondary">{humanizeCheckDetail(check.detail)}</Typography.Text>
              </div>
              <Tag className={`project-trellis-runtime-check__status project-trellis-runtime-check__status--${check.status}`}>
                {check.status === "pass" ? "就绪通过" : "配置中断"}
              </Tag>
            </div>
          ))}
        </div>
      </div>

      <div className="project-trellis-runtime__telemetry-pane">
        <div className="project-trellis-runtime__telemetry-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="project-trellis-runtime__telemetry-title" style={{ display: "flex", alignItems: "center" }}>
            <Terminal size={14} style={{ marginRight: 6, color: "var(--mission-accent)" }} />
            <span>运行事件日志</span>
          </div>
          <Space size={12}>
            <Button
              type="text"
              size="small"
              icon={<Trash2 size={11} />}
              onClick={handleClearLogs}
              style={{ fontSize: 11, padding: "2px 6px", color: "var(--mission-muted)" }}
            >
              清空视图
            </Button>
            <span className="project-trellis-runtime__telemetry-status-dot" />
          </Space>
        </div>
        {recentEvents.length === 0 ? (
          <div className="project-trellis-runtime__telemetry-empty">
            <Typography.Text type="secondary">暂无运行事件</Typography.Text>
          </div>
        ) : (
          <div className="project-trellis-runtime__telemetry-terminal">
            {recentEvents.map((event) => {
              const hasTask = !!event.taskPath;
              const taskFileName = event.taskPath ? event.taskPath.split("/").pop() : "";
              return (
                <div key={event.eventId} className="project-trellis-runtime__telemetry-row">
                  <span className="project-trellis-runtime__telemetry-time">
                    [{formatRuntimeTimeShort(event.createdAt)}]
                  </span>
                  <span className={`project-trellis-runtime__telemetry-kind project-trellis-runtime__telemetry-kind--${getEventClassSuffix(event.eventKind)}`}>
                    {eventKindLabel(event.eventKind).toUpperCase()}
                  </span>
                  <span className="project-trellis-runtime__telemetry-msg">
                    {runtimeEventSummary(event)}
                  </span>
                  {event.actor ? (
                    <span className="project-trellis-runtime__telemetry-actor">
                      @{event.actor}
                    </span>
                  ) : null}
                  {hasTask ? (
                    <span className="project-trellis-runtime__telemetry-badge">
                      📄 {taskFileName}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedCheck && (
        <Modal
          title={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Shield size={16} style={{ color: selectedCheck.status === "pass" ? "var(--mission-success)" : "var(--mission-warning)" }} />
              <span>诊断排障助手 - {CHECK_LABELS[selectedCheck.id] ?? selectedCheck.label}</span>
            </div>
          }
          open={isTroubleshootModalOpen}
          onCancel={() => setIsTroubleshootModalOpen(false)}
          footer={
            <Space>
              <Button onClick={() => setIsTroubleshootModalOpen(false)}>关闭</Button>
            </Space>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 0" }}>
            <div>
              <span style={{ fontWeight: 6, display: "block", marginBottom: 4 }}>诊断目标:</span>
              <Typography.Text>{getTroubleGuide(selectedCheck.id).desc}</Typography.Text>
            </div>
            <div>
              <span style={{ fontWeight: 6, display: "block", marginBottom: 4, color: "var(--mission-warning)" }}>故障根因分析:</span>
              <Typography.Text type="secondary">{getTroubleGuide(selectedCheck.id).reason}</Typography.Text>
            </div>
            <div>
              <span style={{ fontWeight: 6, display: "block", marginBottom: 4 }}>建议诊断步骤:</span>
              <pre style={{
                margin: 0,
                padding: 10,
                background: "#f1f5f9",
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono, monospace)"
              }}>
                {getTroubleGuide(selectedCheck.id).step}
              </pre>
            </div>
            <div>
              <span style={{ fontWeight: 6, display: "block", marginBottom: 4 }}>遥测源证据:</span>
              <Typography.Text type="secondary" style={{ fontFamily: "monospace", fontSize: 11 }}>
                {JSON.stringify(selectedCheck.evidence || { status: selectedCheck.status }, null, 2)}
              </Typography.Text>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function RuntimeMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="project-trellis-runtime-metric">
      <span>{icon}</span>
      <div className="project-trellis-runtime-metric__meta">
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
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

function runtimeEventSummary(event: TrellisRuntimeEvent): string {
  const payloadTitle = event.payload.title;
  if (typeof payloadTitle === "string" && payloadTitle.trim()) {
    return payloadTitle.trim();
  }
  const payloadSummary = event.payload.summary;
  if (typeof payloadSummary === "string" && payloadSummary.trim()) {
    return payloadSummary.trim();
  }
  return event.taskPath ? "任务事件已记录" : "运行事件已记录";
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
