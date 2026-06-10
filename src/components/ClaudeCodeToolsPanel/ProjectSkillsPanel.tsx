import {
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import Editor from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeProjectSkill, ClaudeProjectSkillFileEntry } from "../../types";
import {
  createClaudeProjectSkill,
  deleteClaudeProjectSkill,
  deleteClaudeProjectSkillFile,
  getClaudeProjectSkillFile,
  listClaudeProjectSkillFiles,
  listClaudePluginCacheSkills,
  listClaudeProjectSkills,
  listClaudeUserSkills,
  saveClaudeProjectSkillFile,
  formatClaudeProjectSkillFile,
} from "../../services/claude";
import { openWorkspaceIn } from "../../services/repository";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync, hydrateOpenAppPreference } from "../../services/openAppPreference";
import {
  isClaudeProjectCommand,
  resolveClaudeProjectSkillDisplayPath,
} from "../../utils/claudeProjectSkillPath";
import { isOmcPluginCacheSkill } from "../../utils/omcPluginDetect";
import { installMonacoTrackpadSelectionGuard } from "../../utils/monacoTrackpadSelectionGuard";
import { WISE_MONACO_EDITOR_OPTIONS } from "../../utils/wiseMonacoEditorOptions";

// ── Helpers ──

function joinRepositoryPath(repositoryPath: string, rel: string): string {
  const base = repositoryPath.replace(/\/$/, "");
  const rest = rel.replace(/^\//, "");
  return `${base}/${rest}`;
}

function isValidSkillName(name: string): boolean {
  const t = name.trim();
  if (t.length === 0 || t.length > 128) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(t);
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function monacoLanguageFromPath(path: string | null): string {
  if (!path) return "plaintext";

  const normalized = path.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.toLowerCase() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (["dockerfile", "makefile"].includes(fileName)) {
    return fileName === "dockerfile" ? "dockerfile" : "makefile";
  }

  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["js", "mjs", "cjs", "jsx"].includes(ext)) return "javascript";
  if (["ts", "mts", "cts", "tsx"].includes(ext)) return "typescript";
  if (ext === "py") return "python";
  if (["sh", "bash", "zsh"].includes(ext)) return "shell";
  if (["json", "jsonc"].includes(ext)) return "json";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  if (["toml"].includes(ext)) return "toml";
  if (["ini", "cfg", "conf"].includes(ext)) return "ini";
  if (["xml"].includes(ext)) return "xml";
  if (["sql"].includes(ext)) return "sql";

  return "plaintext";
}

/** `~/.claude/plugins/cache/.../包根` 下某技能的目录绝对路径（与打开目录一致）。 */
function mergeProjectAndUserSkills(
  project: ClaudeProjectSkill[],
  user: ClaudeProjectSkill[],
): ClaudeProjectSkill[] {
  const seen = new Set(project.map((s) => s.name.toLowerCase()));
  const userOnly = user.filter((s) => !seen.has(s.name.toLowerCase()));
  return [...project, ...userOnly];
}

function isUserScopeSkill(skill: ClaudeProjectSkill): boolean {
  return skill.skillScope === "user";
}

function pluginCacheSkillDirectoryAbsPath(skill: ClaudeProjectSkill): string | null {
  const root = skill.pluginCacheRoot?.trim();
  if (!root) return null;
  const base = root.replace(/[/\\]$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}skills${sep}${skill.name}`;
}

function resolvePreferredEditorTarget() {
  const selectedId = getOpenAppPreferenceSync() || DEFAULT_OPEN_APP_ID;
  const selected = DEFAULT_OPEN_APP_TARGETS.find((t) => t.id === selectedId);
  if (selected && selected.kind !== "finder") return selected;
  return DEFAULT_OPEN_APP_TARGETS.find((t) => t.kind !== "finder") ?? null;
}

/** Relative path to a new file under the skill root (not a directory path). */
/** `needle` 须为已 `trim().toLowerCase()` 的字符串；空串表示不过滤。 */
function skillMatchesListSearch(
  skill: ClaudeProjectSkill,
  needle: string,
  repositoryPath?: string,
): boolean {
  if (!needle) return true;
  const parts = [
    skill.name,
    skill.description ?? "",
    skill.pluginCacheRelPath ?? "",
    pluginCacheSkillDirectoryAbsPath(skill) ?? "",
    skill.pluginCacheRoot ?? "",
    skill.skillRootPath ?? "",
    skill.commandRelPath ?? "",
    skill.entryKind ?? "",
  ];
  const repo = repositoryPath?.trim();
  if (repo) {
    parts.push(resolveClaudeProjectSkillDisplayPath(skill, repo));
  }
  return parts.join("\n").toLowerCase().includes(needle);
}

const MONACO_SKILL_EDITOR_OPTIONS = {
  ...WISE_MONACO_EDITOR_OPTIONS,
  fontSize: 12,
};

function isValidSkillRelFilePath(p: string): boolean {
  const t = p.trim().replace(/\\/g, "/");
  if (!t || t.endsWith("/") || t.includes("..")) return false;
  const parts = t.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  for (const seg of parts) {
    if (seg === "." || seg === "..") return false;
  }
  return t.length <= 512;
}

// ── Panel ──

interface Props {
  repositoryPath?: string;
  /** When false, skips loading (hidden tab). */
  active: boolean;
  /** 未安装 OMC 时不展示插件缓存中的 OMC 技能目录。 */
  omcInstalled?: boolean;
  /** 与右栏工具条搜索联动，仅影响列表展示。 */
  listSearch?: string;
  onBindActions?: (actions: ProjectSkillsPanelHandle | null) => void;
  onCountChange?: (count: number) => void;
}

export interface ProjectSkillsPanelHandle {
  refresh: () => void;
  openCreateModal: () => void;
  openSkillsRoot: () => void;
}

interface ProjectSkillCardProps {
  skill: ClaudeProjectSkill;
  repositoryPath: string;
  onEdit: (skill: ClaudeProjectSkill) => void | Promise<void>;
  onOpen: (skill: ClaudeProjectSkill) => void | Promise<void>;
  onDelete: (skill: ClaudeProjectSkill) => void | Promise<void>;
}

const ProjectSkillCard = memo(function ProjectSkillCard({
  skill,
  repositoryPath,
  onEdit,
  onOpen,
  onDelete,
}: ProjectSkillCardProps) {
  const isCommand = isClaudeProjectCommand(skill);
  const absPath = useMemo(
    () => resolveClaudeProjectSkillDisplayPath(skill, repositoryPath),
    [repositoryPath, skill],
  );
  return (
    <div className="app-repository-skills-card">
      <div className="app-repository-skills-card-head">
        <span className="app-repository-skills-name">
          {skill.name}
          {isCommand ? (
            <Tag color="purple" style={{ marginLeft: 6 }}>
              命令
            </Tag>
          ) : null}
        </span>
        <div className="app-repository-skills-card-meta">
          <span className="app-repository-skills-filecount">{skill.fileCount ?? 0} 个文件</span>
          <div className="app-repository-skills-card-actions">
            {!isCommand ? (
              <Button
                type="text"
                size="small"
                className="app-repository-skills-card-icon-btn"
                icon={<EditOutlined />}
                title="编辑"
                aria-label="编辑"
                onClick={() => {
                  void onEdit(skill);
                }}
              />
            ) : null}
            <Button
              type="text"
              size="small"
              className="app-repository-skills-card-icon-btn"
              icon={<FolderOpenOutlined />}
              title={isCommand ? "打开文件" : "打开目录"}
              aria-label={isCommand ? "打开文件" : "打开目录"}
              onClick={() => void onOpen(skill)}
            />
            {!isCommand ? (
              <Popconfirm
                title={`删除技能「${skill.name}」？`}
                description="将删除该技能整个目录（含模板、脚本、示例等所有文件），且不可恢复。"
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={() => {
                  void onDelete(skill);
                }}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  className="app-repository-skills-card-icon-btn"
                  icon={<DeleteOutlined />}
                  title="删除"
                  aria-label="删除"
                />
              </Popconfirm>
            ) : null}
          </div>
        </div>
      </div>
      <div className="app-repository-skills-desc">
        <div className="app-repository-skills-card-desc-main">{skill.description?.trim() || "—"}</div>
        <Typography.Text className="app-repository-skills-card-path-line">{absPath}</Typography.Text>
      </div>
    </div>
  );
});

interface CacheSkillCardProps {
  skill: ClaudeProjectSkill;
  onOpenPluginFolder: (skill: ClaudeProjectSkill) => void | Promise<void>;
}

interface UserSkillCardProps {
  skill: ClaudeProjectSkill;
  onOpenFolder: (skill: ClaudeProjectSkill) => void | Promise<void>;
}

const UserSkillCard = memo(function UserSkillCard({ skill, onOpenFolder }: UserSkillCardProps) {
  const pathLine = skill.skillRootPath?.trim() || skill.name;
  return (
    <div className="app-repository-skills-card">
      <div className="app-repository-skills-card-head">
        <span className="app-repository-skills-name">
          {skill.name}
          <Tag color="blue" style={{ marginLeft: 6 }}>
            用户级
          </Tag>
        </span>
        <div className="app-repository-skills-card-meta">
          <span className="app-repository-skills-filecount">{skill.fileCount ?? 0} 个文件</span>
          <div className="app-repository-skills-card-actions">
            <Button
              type="text"
              size="small"
              className="app-repository-skills-card-icon-btn"
              icon={<FolderOpenOutlined />}
              title="在编辑器中打开该技能目录"
              aria-label="打开目录"
              onClick={() => {
                void onOpenFolder(skill);
              }}
            />
          </div>
        </div>
      </div>
      <div className="app-repository-skills-desc">
        <div className="app-repository-skills-card-desc-main">{skill.description?.trim() || "—"}</div>
        <Typography.Text className="app-repository-skills-card-path-line">{pathLine}</Typography.Text>
      </div>
    </div>
  );
});

const CacheSkillCard = memo(function CacheSkillCard({ skill, onOpenPluginFolder }: CacheSkillCardProps) {
  const pathLine = useMemo(
    () => pluginCacheSkillDirectoryAbsPath(skill) ?? skill.pluginCacheRelPath ?? "",
    [skill],
  );
  return (
    <div className="app-repository-skills-card">
      <div className="app-repository-skills-card-head">
        <span className="app-repository-skills-name">
          {skill.name}
          <Tag color="gold" style={{ marginLeft: 6 }}>
            插件缓存
          </Tag>
        </span>
        <div className="app-repository-skills-card-meta">
          <span className="app-repository-skills-filecount">{skill.fileCount ?? 0} 个文件</span>
          <div className="app-repository-skills-card-actions">
            <Button
              type="text"
              size="small"
              className="app-repository-skills-card-icon-btn"
              icon={<FolderOpenOutlined />}
              title="在编辑器中打开该技能目录"
              aria-label="打开目录"
              onClick={() => {
                void onOpenPluginFolder(skill);
              }}
            />
          </div>
        </div>
      </div>
      <div className="app-repository-skills-desc">
        <div className="app-repository-skills-card-desc-main">{skill.description?.trim() || "—"}</div>
        <Typography.Text className="app-repository-skills-card-path-line">{pathLine}</Typography.Text>
      </div>
    </div>
  );
});

interface SkillFileRowProps {
  entry: ClaudeProjectSkillFileEntry;
  selectedPath: string | null;
  selectedIsDir: boolean;
  onSelect: (path: string, isDir: boolean) => void | Promise<void>;
}

const SkillFileRow = memo(function SkillFileRow({ entry, selectedPath, selectedIsDir, onSelect }: SkillFileRowProps) {
  const depth = entry.path.split("/").length - 1;
  const active = entry.path === selectedPath && entry.isDir === selectedIsDir;
  return (
    <button
      type="button"
      className={`app-repository-skills-file-row${active ? " is-active" : ""}`}
      style={{ paddingLeft: 8 + depth * 10 }}
      onClick={() => onSelect(entry.path, entry.isDir)}
    >
      {entry.isDir ? (
        <FolderOutlined className="app-repository-skills-file-icon" />
      ) : (
        <FileOutlined className="app-repository-skills-file-icon" />
      )}
      <span className="app-repository-skills-file-name">{entry.path}</span>
      {!entry.isDir && entry.sizeBytes != null ? (
        <span className="app-repository-skills-file-meta">{formatBytes(entry.sizeBytes)}</span>
      ) : null}
    </button>
  );
});

const hasScopePath = (p: string | undefined): p is string => !!p?.trim();

export function ProjectSkillsPanel({
  repositoryPath,
  active,
  omcInstalled = false,
  listSearch = "",
  onBindActions,
  onCountChange,
}: Props) {
  const scopePathAvailable = hasScopePath(repositoryPath);
  const [skills, setSkills] = useState<ClaudeProjectSkill[]>([]);
  const [cacheSkills, setCacheSkills] = useState<ClaudeProjectSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [skillFiles, setSkillFiles] = useState<ClaudeProjectSkillFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDir, setSelectedIsDir] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editBaseline, setEditBaseline] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editFormatting, setEditFormatting] = useState(false);
  const [autoFormatOnSave, setAutoFormatOnSave] = useState(false);
  const trackpadGuardRef = useRef<IDisposable | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const [addFileOpen, setAddFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [addFileBusy, setAddFileBusy] = useState(false);

  const editContentRef = useRef(editContent);
  const editBaselineRef = useRef(editBaseline);
  editContentRef.current = editContent;
  editBaselineRef.current = editBaseline;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, userList, cacheList] = await Promise.all([
        scopePathAvailable ? listClaudeProjectSkills(repositoryPath) : Promise.resolve([]),
        listClaudeUserSkills(),
        listClaudePluginCacheSkills(),
      ]);
      setSkills(mergeProjectAndUserSkills(list, userList));
      setCacheSkills(cacheList);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scopePathAvailable, repositoryPath]);

  useEffect(() => {
    void hydrateOpenAppPreference();
  }, []);

  useEffect(() => {
    onBindActions?.({
      refresh: () => {
        void load();
      },
      openCreateModal: () => {
        if (!scopePathAvailable) {
          message.warning("请先选择工作区或仓库，或为工作区配置根目录");
          return;
        }
        setCreateOpen(true);
      },
      openSkillsRoot: () => {
        if (!scopePathAvailable) {
          message.warning("请先选择工作区或仓库，或为工作区配置根目录");
          return;
        }
        void openSkillsRoot();
      },
    });
    return () => {
      onBindActions?.(null);
    };
  }, [load, onBindActions, scopePathAvailable]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, repositoryPath, load]);

  const visibleCacheSkillsBase = useMemo(
    () => (omcInstalled ? cacheSkills : cacheSkills.filter((s) => !isOmcPluginCacheSkill(s))),
    [cacheSkills, omcInstalled],
  );

  useEffect(() => {
    onCountChange?.(skills.length + visibleCacheSkillsBase.length);
  }, [onCountChange, skills.length, visibleCacheSkillsBase.length]);

  const listSearchNeedle = useMemo(() => listSearch.trim().toLowerCase(), [listSearch]);

  const visibleProjectSkills = useMemo(() => {
    const base = skills.filter((s) => !isUserScopeSkill(s));
    if (!listSearchNeedle) return base;
    return base.filter((s) => skillMatchesListSearch(s, listSearchNeedle, repositoryPath));
  }, [skills, listSearchNeedle, repositoryPath]);

  const visibleUserSkills = useMemo(() => {
    const base = skills.filter((s) => isUserScopeSkill(s));
    if (!listSearchNeedle) return base;
    return base.filter((s) => skillMatchesListSearch(s, listSearchNeedle, repositoryPath));
  }, [skills, listSearchNeedle, repositoryPath]);

  const visibleCacheSkills = useMemo(() => {
    if (!listSearchNeedle) return visibleCacheSkillsBase;
    return visibleCacheSkillsBase.filter((s) => skillMatchesListSearch(s, listSearchNeedle));
  }, [visibleCacheSkillsBase, listSearchNeedle]);

  const hasFilteredSkills =
    visibleProjectSkills.length > 0 || visibleUserSkills.length > 0 || visibleCacheSkills.length > 0;

  const loadSkillFileList = useCallback(
    async (skillName: string): Promise<ClaudeProjectSkillFileEntry[]> => {
      if (!scopePathAvailable) return [];
      setFilesLoading(true);
      try {
        const files = await listClaudeProjectSkillFiles(repositoryPath, skillName);
        setSkillFiles(files);
        return files;
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
        setSkillFiles([]);
        return [];
      } finally {
        setFilesLoading(false);
      }
    },
    [scopePathAvailable, repositoryPath],
  );

  const loadFileContent = useCallback(
    async (skillName: string, relPath: string) => {
      if (!scopePathAvailable) return;
      setEditLoading(true);
      setReadError(null);
      try {
        const text = await getClaudeProjectSkillFile(repositoryPath, skillName, relPath);
        setEditContent(text);
        setEditBaseline(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setReadError(msg);
        setEditContent("");
        setEditBaseline("");
      } finally {
        setEditLoading(false);
      }
    },
    [scopePathAvailable, repositoryPath],
  );

  async function openSkillsRoot() {
    if (!scopePathAvailable) {
      message.warning("请先选择工作区或仓库，或为工作区配置根目录");
      return;
    }
    const p = joinRepositoryPath(repositoryPath, ".claude/skills");
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在「打开方式」中配置");
      return;
    }
    try {
      if (target.kind === "command") {
        await openWorkspaceIn(p, { command: target.command, args: target.args });
      } else {
        await openWorkspaceIn(p, { appName: target.appName, args: target.args });
      }
    } catch {
      message.warning("尚未创建 .claude/skills，可先新建一个技能");
    }
  }

  const openUserSkillFolder = useCallback(async (skill: ClaudeProjectSkill) => {
    const p = skill.skillRootPath?.trim();
    if (!p) {
      message.warning("未记录技能目录路径");
      return;
    }
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在“打开方式”中配置");
      return;
    }
    try {
      if (target.kind === "command") {
        await openWorkspaceIn(p, { command: target.command, args: target.args });
      } else {
        await openWorkspaceIn(p, { appName: target.appName, args: target.args });
      }
    } catch {
      message.warning("无法在编辑器中打开该路径");
    }
  }, []);

  const openPluginCacheSkillFolder = useCallback(async (skill: ClaudeProjectSkill) => {
    const p = pluginCacheSkillDirectoryAbsPath(skill);
    if (!p) {
      message.warning("未记录插件根路径");
      return;
    }
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在“打开方式”中配置");
      return;
    }
    try {
      if (target.kind === "command") {
        await openWorkspaceIn(p, { command: target.command, args: target.args });
      } else {
        await openWorkspaceIn(p, { appName: target.appName, args: target.args });
      }
    } catch {
      message.warning("无法在编辑器中打开该路径");
    }
  }, []);

  const openSkillLocation = useCallback(
    async (skill: ClaudeProjectSkill) => {
      if (!scopePathAvailable) {
        message.warning("请先选择工作区或仓库");
        return;
      }
      const p = resolveClaudeProjectSkillDisplayPath(skill, repositoryPath);
      const target = resolvePreferredEditorTarget();
      if (!target) {
        message.warning("未找到可用编辑器，请先在「打开方式」中配置");
        return;
      }
      try {
        if (target.kind === "command") {
          await openWorkspaceIn(p, { command: target.command, args: target.args });
        } else {
          await openWorkspaceIn(p, { appName: target.appName, args: target.args });
        }
      } catch {
        message.warning(isClaudeProjectCommand(skill) ? "该命令文件不存在" : "该技能目录不存在");
      }
    },
    [scopePathAvailable, repositoryPath],
  );

  async function openSkillRelInEditor(skillName: string, relPath: string) {
    if (!scopePathAvailable) {
      message.warning("请先选择工作区或仓库");
      return;
    }
    const p = joinRepositoryPath(repositoryPath, `.claude/skills/${skillName}/${relPath}`);
    const target = resolvePreferredEditorTarget();
    if (!target) {
      message.warning("未找到可用编辑器，请先在“打开方式”中配置");
      return;
    }
    try {
      if (target.kind === "command") {
        await openWorkspaceIn(p, { command: target.command, args: target.args });
      } else {
        await openWorkspaceIn(p, { appName: target.appName, args: target.args });
      }
    } catch {
      message.warning("无法在编辑器中打开该路径");
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!isValidSkillName(name)) {
      message.warning("名称须以字母或数字开头，仅含字母、数字、下划线、连字符，最长 128 字符");
      return;
    }
    if (!scopePathAvailable) {
      message.warning("请先选择工作区或仓库");
      return;
    }
    setCreating(true);
    try {
      await createClaudeProjectSkill(repositoryPath, name);
      setCreateOpen(false);
      setNewName("");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const closeEditor = useCallback(() => {
    trackpadGuardRef.current?.dispose();
    trackpadGuardRef.current = null;
    setEditingName(null);
    setSkillFiles([]);
    setSelectedPath(null);
    setSelectedIsDir(false);
    setEditContent("");
    setEditBaseline("");
    setReadError(null);
    setFilesLoading(false);
    setEditLoading(false);
    setAddFileOpen(false);
    setNewFilePath("");
  }, []);

  const handleDelete = useCallback(
    async (skill: ClaudeProjectSkill) => {
      if (isClaudeProjectCommand(skill)) {
        message.warning("命令文件请在 .claude/commands/ 中手动管理");
        return;
      }
      if (!scopePathAvailable) {
        message.warning("请先选择工作区或仓库");
        return;
      }
      try {
        await deleteClaudeProjectSkill(repositoryPath, skill.name);
        if (editingName === skill.name) {
          closeEditor();
        }
        await load();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      }
    },
    [scopePathAvailable, repositoryPath, editingName, closeEditor, load],
  );

  const requestCloseEditor = useCallback(() => {
    if (!selectedIsDir && selectedPath && editContentRef.current !== editBaselineRef.current) {
      Modal.confirm({
        title: "放弃未保存的更改？",
        okText: "放弃",
        okType: "danger",
        cancelText: "继续编辑",
        onOk: closeEditor,
      });
    } else {
      closeEditor();
    }
  }, [closeEditor, selectedIsDir, selectedPath]);

  const openEditor = useCallback(
    async (skill: ClaudeProjectSkill) => {
      if (isClaudeProjectCommand(skill)) {
        message.info("命令文件请使用「打开文件」在外部编辑器中修改");
        return;
      }
      const name = skill.name;
      setEditingName(name);
      setSelectedPath(null);
      setSelectedIsDir(false);
      setEditContent("");
      setEditBaseline("");
      setReadError(null);
      const files = await loadSkillFileList(name);
      const skillMd = files.find((f) => !f.isDir && f.path === "SKILL.md");
      const firstFile = files.find((f) => !f.isDir);
      const pick = skillMd?.path ?? firstFile?.path ?? null;
      if (pick) {
        setSelectedPath(pick);
        setSelectedIsDir(false);
        await loadFileContent(name, pick);
      }
    },
    [loadFileContent, loadSkillFileList],
  );

  const applySelectEntry = useCallback(
    async (skillName: string, path: string, isDir: boolean) => {
      setSelectedPath(path);
      setSelectedIsDir(isDir);
      setReadError(null);
      if (isDir) {
        setEditContent("");
        setEditBaseline("");
        return;
      }
      await loadFileContent(skillName, path);
    },
    [loadFileContent],
  );

  const trySelectEntry = useCallback(
    (path: string, isDir: boolean) => {
      if (!editingName) return;
      if (path === selectedPath && isDir === selectedIsDir) return;
      if (!selectedIsDir && selectedPath && editContentRef.current !== editBaselineRef.current) {
        Modal.confirm({
          title: "放弃未保存的更改？",
          content: "将切换到其它文件或目录。",
          okText: "放弃并切换",
          okType: "danger",
          cancelText: "继续编辑",
          onOk: () => {
            void applySelectEntry(editingName, path, isDir);
          },
        });
        return;
      }
      void applySelectEntry(editingName, path, isDir);
    },
    [applySelectEntry, editingName, selectedIsDir, selectedPath],
  );

  async function handleSaveCurrentFile() {
    if (!scopePathAvailable || !editingName || !selectedPath || selectedIsDir) return;
    setEditSaving(true);
    try {
      let contentToSave = editContent;
      if (autoFormatOnSave) {
        try {
          contentToSave = await formatClaudeProjectSkillFile(repositoryPath, editingName, selectedPath, editContent);
          setEditContent(contentToSave);
        } catch (e) {
          message.warning(`自动格式化失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await saveClaudeProjectSkillFile(repositoryPath, editingName, selectedPath, contentToSave);
      setEditBaseline(contentToSave);
      await loadSkillFileList(editingName);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleRefreshSkillFiles() {
    if (!editingName) return;
    await loadSkillFileList(editingName);
    await load();
  }

  async function handleAddFile() {
    if (!scopePathAvailable || !editingName) return;
    const rel = newFilePath.trim().replace(/\\/g, "/");
    if (!isValidSkillRelFilePath(rel)) {
      message.warning("请输入相对路径，如 examples/sample.md，勿使用 .. 或以 / 结尾");
      return;
    }
    const exists = skillFiles.some((f) => f.path === rel);
    if (exists) {
      message.warning("该路径已存在");
      return;
    }
    setAddFileBusy(true);
    try {
      await saveClaudeProjectSkillFile(repositoryPath, editingName, rel, "");
      setAddFileOpen(false);
      setNewFilePath("");
      await loadSkillFileList(editingName);
      await load();
      setSelectedPath(rel);
      setSelectedIsDir(false);
      await loadFileContent(editingName, rel);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAddFileBusy(false);
    }
  }

  async function handleDeleteCurrentEntry() {
    if (!scopePathAvailable || !editingName || !selectedPath) return;
    try {
      await deleteClaudeProjectSkillFile(repositoryPath, editingName, selectedPath);
      const nextFiles = await listClaudeProjectSkillFiles(repositoryPath, editingName);
      setSkillFiles(nextFiles);
      await load();
      const nextSelectable =
        nextFiles.find((f) => !f.isDir && f.path === "SKILL.md") ??
        nextFiles.find((f) => !f.isDir) ??
        nextFiles.find((f) => f.isDir) ??
        null;
      if (nextSelectable) {
        setSelectedPath(nextSelectable.path);
        setSelectedIsDir(nextSelectable.isDir);
        if (!nextSelectable.isDir) {
          await loadFileContent(editingName, nextSelectable.path);
        } else {
          setEditContent("");
          setEditBaseline("");
        }
      } else {
        setSelectedPath(null);
        setSelectedIsDir(false);
        setEditContent("");
        setEditBaseline("");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleFormatCurrentFile() {
    if (!scopePathAvailable || !editingName || !selectedPath || selectedIsDir) return;
    setEditFormatting(true);
    try {
      const formatted = await formatClaudeProjectSkillFile(repositoryPath, editingName, selectedPath, editContent);
      setEditContent(formatted);
    } catch (e) {
      message.warning(e instanceof Error ? e.message : String(e));
    } finally {
      setEditFormatting(false);
    }
  }

  const drawerBusy = filesLoading || (!selectedIsDir && editLoading);

  const selectedMonacoLanguage = useMemo(() => monacoLanguageFromPath(selectedPath), [selectedPath]);

  return (
    <div className="app-repository-skills">
      <div className="app-repository-skills-table-wrap">
        {loading && skills.length === 0 && cacheSkills.length === 0 ? (
          <div className="app-repository-skills-loading">
            <Spin size="small" />
          </div>
        ) : skills.length === 0 && cacheSkills.length === 0 ? (
          <Empty
            description={
              scopePathAvailable
                ? "暂无技能，点击「新建」添加"
                : "暂无用户级或插件缓存技能；选择工作区/仓库或配置工作区根目录后可管理项目级技能"
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : !hasFilteredSkills ? (
          <Empty description="没有符合筛选的技能" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="app-repository-skills-list">
            {visibleProjectSkills.map((skill) => (
              <ProjectSkillCard
                key={`project:${skill.name}`}
                skill={skill}
                repositoryPath={repositoryPath!}
                onEdit={openEditor}
                onOpen={openSkillLocation}
                onDelete={handleDelete}
              />
            ))}
            {visibleUserSkills.map((skill) => (
              <UserSkillCard
                key={`user:${skill.name}`}
                skill={skill}
                onOpenFolder={openUserSkillFolder}
              />
            ))}
            {visibleCacheSkills.map((skill) => (
              <CacheSkillCard
                key={`cache:${skill.pluginCacheRelPath ?? ""}:${skill.name}`}
                skill={skill}
                onOpenPluginFolder={openPluginCacheSkillFolder}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        title="新建技能"
        wrapClassName="app-repository-skills-modal"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setNewName("");
        }}
        okText="创建"
        confirmLoading={creating}
        onOk={() => void handleCreate()}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" className="app-repository-skills-modal-hint">
          将在 <Typography.Text code>.claude/skills/名称/</Typography.Text> 下创建目录，并生成入口文件{" "}
          <Typography.Text code>SKILL.md</Typography.Text>。之后可在该目录内添加模板、示例、脚本等任意文件，Claude
          Code 会按官方约定加载整个技能文件夹。
        </Typography.Paragraph>
        <Input
          placeholder="例如 my-helper"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={() => void handleCreate()}
          maxLength={128}
          autoFocus
        />
      </Modal>

      <Modal
        title="新建文件"
        wrapClassName="app-repository-skills-modal"
        open={addFileOpen}
        onCancel={() => {
          setAddFileOpen(false);
          setNewFilePath("");
        }}
        okText="创建"
        confirmLoading={addFileBusy}
        onOk={() => void handleAddFile()}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" className="app-repository-skills-modal-hint">
          相对于当前技能目录的路径，例如 <Typography.Text code>examples/sample.md</Typography.Text> 或{" "}
          <Typography.Text code>scripts/check.sh</Typography.Text>。将创建缺失的父目录。
        </Typography.Paragraph>
        <Input
          placeholder="examples/note.md"
          value={newFilePath}
          onChange={(e) => setNewFilePath(e.target.value)}
          onPressEnter={() => void handleAddFile()}
          maxLength={512}
          autoFocus
        />
      </Modal>

      <Drawer
        title={
          editingName ? (
            <span className="app-repository-skills-drawer-title">
              技能 <Typography.Text code>{editingName}</Typography.Text>
              <Typography.Text type="secondary" className="app-repository-skills-drawer-sub">
                整个目录
              </Typography.Text>
            </span>
          ) : null
        }
        placement="right"
        size="min(980px, 100vw)"
        open={editingName !== null}
        onClose={requestCloseEditor}
        destroyOnHidden
        classNames={{ body: "app-repository-skills-drawer-body app-repository-skills-drawer-body--split" }}
        footer={
          <div className="app-repository-skills-drawer-footer app-repository-skills-drawer-footer--split">
            <Space wrap>
              <div className="app-repository-skills-auto-format">
                <Switch
                  size="small"
                  checked={autoFormatOnSave}
                  onChange={setAutoFormatOnSave}
                />
                <span>保存时自动格式化</span>
              </div>
              {selectedPath ? (
                <Popconfirm
                  title={selectedIsDir ? `删除目录「${selectedPath}」？` : `删除文件「${selectedPath}」？`}
                  description={
                    selectedIsDir
                      ? "将删除该目录及其下所有文件，且不可恢复。"
                      : "删除后可在「新建文件」中重建路径。"
                  }
                  okText="删除"
                  okType="danger"
                  cancelText="取消"
                  onConfirm={() => void handleDeleteCurrentEntry()}
                >
                  <Button size="small" danger disabled={!editingName}>
                    删除当前项
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
            <Space>
              <Button size="small" onClick={() => void handleRefreshSkillFiles()} disabled={!editingName}>
                刷新列表
              </Button>
              <Button
                size="small"
                loading={editFormatting}
                disabled={drawerBusy || selectedIsDir || !selectedPath || !!readError}
                onClick={() => void handleFormatCurrentFile()}
              >
                格式化
              </Button>
              <Button size="small" onClick={requestCloseEditor}>
                关闭
              </Button>
              <Button
                size="small"
                type="primary"
                loading={editSaving}
                disabled={drawerBusy || selectedIsDir || !selectedPath || editContent === editBaseline || !!readError}
                onClick={() => void handleSaveCurrentFile()}
              >
                保存当前文件
              </Button>
            </Space>
          </div>
        }
      >
        <div className="app-repository-skills-editor-layout">
          <div className="app-repository-skills-file-pane">
            <div className="app-repository-skills-file-pane-toolbar">
              <Typography.Text type="secondary" className="app-repository-skills-file-pane-label">
                文件列表
              </Typography.Text>
              <Space size={4}>
                <Button
                  size="small"
                  type="link"
                  className="app-repository-skills-link-btn"
                  icon={<ReloadOutlined />}
                  disabled={!editingName || filesLoading}
                  onClick={() => void handleRefreshSkillFiles()}
                />
                <Button
                  size="small"
                  type="link"
                  className="app-repository-skills-link-btn"
                  icon={<PlusOutlined />}
                  disabled={!editingName}
                  onClick={() => setAddFileOpen(true)}
                >
                  新建文件
                </Button>
              </Space>
            </div>
            <div className="app-repository-skills-file-list">
              {filesLoading && skillFiles.length === 0 ? (
                <div className="app-repository-skills-drawer-loading">
                  <Spin size="small" />
                </div>
              ) : skillFiles.length === 0 ? (
                <Empty description="目录为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                skillFiles.map((f) => (
                  <SkillFileRow
                    key={`${f.isDir ? "d" : "f"}:${f.path}`}
                    entry={f}
                    selectedPath={selectedPath}
                    selectedIsDir={selectedIsDir}
                    onSelect={trySelectEntry}
                  />
                ))
              )}
            </div>
          </div>
          <div className="app-repository-skills-editor-pane">
            {!selectedPath ? (
              <Typography.Paragraph type="secondary" className="app-repository-skills-editor-empty">
                该技能目录下暂无文件，可使用「新建文件」添加。
              </Typography.Paragraph>
            ) : selectedIsDir ? (
              <div className="app-repository-skills-editor-dir">
                <Typography.Paragraph>
                  目录 <Typography.Text code>{selectedPath}</Typography.Text>
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary">
                  目录内文件请在左侧选择；也可在编辑器中增删文件后点「刷新列表」。
                </Typography.Paragraph>
                <Button
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={() => editingName && void openSkillRelInEditor(editingName, selectedPath)}
                >
                  在编辑器中打开此目录
                </Button>
              </div>
            ) : readError ? (
              <div className="app-repository-skills-editor-readerr">
                <Alert type="warning" message={readError} showIcon />
                <Button
                  size="small"
                  style={{ marginTop: 10 }}
                  icon={<FolderOpenOutlined />}
                  onClick={() => editingName && selectedPath && void openSkillRelInEditor(editingName, selectedPath)}
                >
                  在编辑器中打开此文件
                </Button>
              </div>
            ) : editLoading ? (
              <div className="app-repository-skills-drawer-loading">
                <Spin size="small" />
              </div>
            ) : (
              <div className="app-repository-skills-editor-wrap">
                <Editor
                  key={`${selectedPath ?? ""}:${selectedMonacoLanguage}`}
                  className="app-repository-skills-editor-monaco"
                  height="100%"
                  path={selectedPath ?? undefined}
                  defaultLanguage={selectedMonacoLanguage}
                  language={selectedMonacoLanguage}
                  value={editContent}
                  onChange={(value) => setEditContent(value ?? "")}
                  options={MONACO_SKILL_EDITOR_OPTIONS}
                  onMount={(editor) => {
                    trackpadGuardRef.current?.dispose();
                    trackpadGuardRef.current = installMonacoTrackpadSelectionGuard(editor);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
