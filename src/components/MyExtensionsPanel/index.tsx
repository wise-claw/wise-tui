import {
  ApiOutlined,
  AppstoreOutlined,
  CloudDownloadOutlined,
  CodeOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Input, Space, Spin, Tooltip, Typography } from "antd";
import { openPath } from "@tauri-apps/plugin-opener";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthorPanelEmptyShell,
  AuthorPanelHubTab,
  AuthorPanelHubTabs,
  AuthorPanelListShell,
  AuthorPanelPageShell,
} from "../AuthorPanel/AuthorPanelPageShell";
import { HubItem, HubItems, HubTag, avatarColorFor } from "../HubCard";
import {
  WISE_UI_EVENT_EXTENSION_LIBRARY_CHANGED,
  type ExtensionLibraryChangedDetail,
} from "../../constants/extensionLibraryUiEvents";
import {
  getExtensionLibraryHome,
  getExtensionLibraryItemContent,
  installExtensionFromLibrary,
  listExtensionLibrary,
  listExtensionLibrarySnapshotTree,
  removeExtensionLibraryItem,
  saveExtensionLibraryItemContent,
  updateExtensionLibraryItemName,
} from "../../services/myExtensions";
import type {
  ExtensionLibraryContent,
  ExtensionLibraryItem,
  MyExtensionKind,
  SnapshotTreeNode,
} from "../../types/myExtension";
import "../ExtensionsPanel/index.css";
import { ExtensionSnapshotTree } from "./ExtensionSnapshotTree";
import { MyExtensionsUsageHelpIcon } from "./usageGuide";
import "./index.css";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const KIND_FILTERS: Array<{ key: "all" | MyExtensionKind; label: string }> = [
  { key: "all", label: "全部" },
  { key: "mcp", label: "MCP" },
  { key: "skill", label: "技能" },
  { key: "plugin", label: "插件" },
  { key: "hook", label: "Hooks" },
  { key: "script", label: "脚本" },
];

function leafExistsInTree(nodes: SnapshotTreeNode[], key: string): boolean {
  for (const node of nodes) {
    if (node.isLeaf && node.key === key) return true;
    if (node.children?.length && leafExistsInTree(node.children, key)) return true;
  }
  return false;
}

function firstLeafKey(nodes: SnapshotTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.isLeaf) return node.key;
    if (node.children?.length) {
      const nested = firstLeafKey(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

function kindLabel(kind: MyExtensionKind): string {
  const map: Record<MyExtensionKind, string> = {
    package: "扩展包",
    mcp: "MCP",
    skill: "技能",
    plugin: "插件",
    hook: "Hook",
    script: "脚本",
  };
  return map[kind] ?? kind;
}

function kindIcon(kind: MyExtensionKind) {
  switch (kind) {
    case "mcp":
      return <ApiOutlined />;
    case "skill":
      return <ToolOutlined />;
    case "plugin":
      return <AppstoreOutlined />;
    case "hook":
      return <NodeIndexOutlined />;
    case "script":
      return <CodeOutlined />;
    default:
      return <AppstoreOutlined />;
  }
}

export interface MyExtensionsPanelProps {
  repositoryPath?: string | null;
  /** 工作台配置层当前是否可见（从主界面再次打开配置时刷新列表） */
  configLayerActive?: boolean;
}

export function MyExtensionsPanel({
  repositoryPath,
  configLayerActive = true,
}: MyExtensionsPanelProps) {
  const { message, modal } = App.useApp();
  const [library, setLibrary] = useState<ExtensionLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MyExtensionKind>("all");
  const [libraryHome, setLibraryHome] = useState<string | null>(null);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [snapshotTree, setSnapshotTree] = useState<SnapshotTreeNode[]>([]);
  const [activeFileKey, setActiveFileKey] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<ExtensionLibraryContent | null>(null);
  const [editorDraft, setEditorDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [treeLoading, setTreeLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [savingName, setSavingName] = useState(false);
  /** 切换扩展条目时递增，用于丢弃过期的树/文件加载 */
  const snapshotSessionRef = useRef(0);
  const fileLoadSeqRef = useRef(0);
  /** 当前 snapshotTree 对应的扩展条目 id，避免切换条目时用旧树路径读新条目 */
  const [loadedTreeItemId, setLoadedTreeItemId] = useState<string | null>(null);

  const hasRepo = Boolean(repositoryPath?.trim());
  const repoPath = repositoryPath?.trim() ?? "";

  const loadLibrary = useCallback(
    async (options?: ExtensionLibraryChangedDetail) => {
      setLibraryLoading(true);
      try {
        const [items, home] = await Promise.all([listExtensionLibrary(), getExtensionLibraryHome()]);
        setLibrary(items);
        setLibraryHome(home);
        const selectId = options?.selectedItemId;
        setActiveLibraryId((prev) => {
          if (selectId && items.some((item) => item.id === selectId)) {
            return selectId;
          }
          if (prev && items.some((item) => item.id === prev)) {
            return prev;
          }
          return items[0]?.id ?? null;
        });
        if (selectId) {
          setKindFilter("all");
        }
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLibraryLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (!configLayerActive) return;
    void loadLibrary();
  }, [configLayerActive, loadLibrary]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<ExtensionLibraryChangedDetail>).detail;
      void loadLibrary(detail);
    };
    window.addEventListener(WISE_UI_EVENT_EXTENSION_LIBRARY_CHANGED, onChanged);
    return () => window.removeEventListener(WISE_UI_EVENT_EXTENSION_LIBRARY_CHANGED, onChanged);
  }, [loadLibrary]);

  const selectedItem = useMemo(
    () => library.find((item) => item.id === activeLibraryId) ?? null,
    [activeLibraryId, library],
  );

  const selectLibraryItem = useCallback(
    (itemId: string) => {
      if (itemId === activeLibraryId) return;
      snapshotSessionRef.current += 1;
      fileLoadSeqRef.current += 1;
      setLoadedTreeItemId(null);
      setSnapshotTree([]);
      setActiveFileKey(null);
      setActiveContent(null);
      setEditorDraft("");
      setActiveLibraryId(itemId);
    },
    [activeLibraryId],
  );

  useEffect(() => {
    snapshotSessionRef.current += 1;
    fileLoadSeqRef.current += 1;
    setLoadedTreeItemId(null);
    setSnapshotTree([]);
    setActiveFileKey(null);
    setActiveContent(null);
    setEditorDraft("");
    if (!selectedItem) {
      setNameDraft("");
      return;
    }
    setNameDraft(selectedItem.name);
  }, [selectedItem?.id]);

  const loadSnapshotTree = useCallback(async () => {
    if (!selectedItem) {
      setSnapshotTree([]);
      return;
    }
    const session = snapshotSessionRef.current;
    const itemId = selectedItem.id;
    setTreeLoading(true);
    try {
      const tree = await listExtensionLibrarySnapshotTree(itemId);
      if (session !== snapshotSessionRef.current) return;
      setSnapshotTree(tree);
      setLoadedTreeItemId(itemId);
      setActiveFileKey((prev) => {
        if (session !== snapshotSessionRef.current) return null;
        if (prev && leafExistsInTree(tree, prev)) return prev;
        return firstLeafKey(tree);
      });
    } catch (e) {
      if (session !== snapshotSessionRef.current) return;
      setSnapshotTree([]);
      setLoadedTreeItemId(null);
      setActiveFileKey(null);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (session === snapshotSessionRef.current) {
        setTreeLoading(false);
      }
    }
  }, [message, selectedItem]);

  const requestSelectFile = useCallback(
    (key: string) => {
      if (!key) {
        setActiveFileKey(null);
        return;
      }
      if (key === activeFileKey) return;
      const dirty = Boolean(activeContent && editorDraft !== activeContent.content);
      if (dirty) {
        modal.confirm({
          title: "未保存的更改",
          content: "当前文件有未保存的修改，切换后将丢失。是否继续？",
          okText: "放弃并切换",
          cancelText: "取消",
          onOk: () => setActiveFileKey(key),
        });
        return;
      }
      setActiveFileKey(key);
    },
    [activeContent, activeFileKey, editorDraft, modal],
  );

  useEffect(() => {
    void loadSnapshotTree();
  }, [loadSnapshotTree]);

  const loadFileContent = useCallback(
    async (relativePath: string) => {
      if (!selectedItem) return;
      const session = snapshotSessionRef.current;
      const itemId = selectedItem.id;
      const seq = ++fileLoadSeqRef.current;
      setContentLoading(true);
      try {
        const payload = await getExtensionLibraryItemContent(itemId, relativePath);
        if (session !== snapshotSessionRef.current || seq !== fileLoadSeqRef.current) {
          return;
        }
        setActiveContent(payload);
        setEditorDraft(payload.content);
      } catch (e) {
        if (session !== snapshotSessionRef.current || seq !== fileLoadSeqRef.current) {
          return;
        }
        setActiveContent(null);
        setEditorDraft("");
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (session === snapshotSessionRef.current && seq === fileLoadSeqRef.current) {
          setContentLoading(false);
        }
      }
    },
    [message, selectedItem],
  );

  useEffect(() => {
    if (!selectedItem || !activeFileKey) {
      setActiveContent(null);
      setEditorDraft("");
      return;
    }
    if (loadedTreeItemId !== selectedItem.id) {
      return;
    }
    if (!leafExistsInTree(snapshotTree, activeFileKey)) {
      return;
    }
    void loadFileContent(activeFileKey);
  }, [activeFileKey, loadFileContent, loadedTreeItemId, selectedItem, snapshotTree]);

  const filteredLibrary = useMemo(() => {
    let xs = library;
    if (kindFilter !== "all") {
      xs = xs.filter((e) => e.kind === kindFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      xs = xs.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description?.toLowerCase().includes(q) ?? false) ||
          (e.capturedFromRepository?.toLowerCase().includes(q) ?? false),
      );
    }
    return xs;
  }, [kindFilter, library, query]);

  const counts = useMemo(() => {
    const byKind = (k: MyExtensionKind) => library.filter((e) => e.kind === k).length;
    return {
      all: library.length,
      mcp: byKind("mcp"),
      skill: byKind("skill"),
      plugin: byKind("plugin"),
      hook: byKind("hook"),
      script: byKind("script"),
      package: byKind("package"),
    };
  }, [library]);

  const handleInstall = useCallback(
    async (item: ExtensionLibraryItem, scope: "global" | "repository") => {
      if (scope === "repository" && !hasRepo) {
        message.warning("请先在侧栏选择目标仓库");
        return;
      }
      setBusyId(item.id);
      try {
        const result = await installExtensionFromLibrary(item.id, {
          installScope: scope,
          repositoryPath: scope === "repository" ? repoPath : null,
        });
        const installedHint =
          item.kind === "mcp"
            ? `已合并 MCP 配置（保留文件内其它字段）：${result.installedPath}`
            : scope === "global"
              ? `已全局安装到 Claude Code：${result.installedPath}`
              : `已安装到当前仓库：${result.installedPath}`;
        message.success(installedHint);
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [hasRepo, message, repoPath],
  );

  const handleRemove = useCallback(
    (item: ExtensionLibraryItem) => {
      modal.confirm({
        title: `删除「${item.name}」？`,
        content: "将从本机扩展库删除该条目及其快照；不会卸载已安装到仓库或全局的副本。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          setRemovingId(item.id);
          try {
            await removeExtensionLibraryItem(item.id);
            message.success("已删除");
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            throw e;
          } finally {
            setRemovingId(null);
          }
        },
      });
    },
    [message, modal],
  );

  const handleSaveName = useCallback(async () => {
    if (!selectedItem) return;
    setSavingName(true);
    try {
      const updated = await updateExtensionLibraryItemName(selectedItem.id, nameDraft);
      setLibrary((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      message.success("名称已更新");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  }, [message, nameDraft, selectedItem]);

  const handleSaveContent = useCallback(async () => {
    if (!selectedItem || !activeContent) return;
    setSavingContent(true);
    try {
      await saveExtensionLibraryItemContent(
        selectedItem.id,
        activeContent.relativePath,
        editorDraft,
      );
      setActiveContent({ ...activeContent, content: editorDraft });
      message.success("内容已保存");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingContent(false);
    }
  }, [activeContent, editorDraft, message, selectedItem]);

  return (
    <AuthorPanelPageShell
      className="app-my-extensions-panel app-extensions-panel"
      id="my-extensions"
      icon={<AppstoreOutlined />}
      title="我的扩展"
      subtitle={
        <span className="app-my-extensions-panel__subtitle-wrap">
          本机扩展库 · 编辑快照（MCP / 技能 / Hooks / 脚本）
          <MyExtensionsUsageHelpIcon />
        </span>
      }
      actions={
        <Space size={8} wrap>
          <Input
            className="app-extensions-panel__search"
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索扩展库…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 176 }}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={libraryLoading}
            onClick={() => void loadLibrary()}
          >
            刷新
          </Button>
          {libraryHome ? (
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => void openPath(libraryHome).catch(() => undefined)}
            >
              扩展库目录
            </Button>
          ) : null}
        </Space>
      }
    >
      <div className="app-my-extensions-panel__library-head">
        <h2 className="app-my-extensions-panel__section-title">扩展库</h2>
        <AuthorPanelHubTabs aria-label="扩展库类型">
        {KIND_FILTERS.map((tab) => (
          <AuthorPanelHubTab
            key={tab.key}
            active={kindFilter === tab.key}
            label={tab.label}
            count={counts[tab.key as keyof typeof counts] ?? 0}
            onClick={() => setKindFilter(tab.key)}
          />
        ))}
        </AuthorPanelHubTabs>
      </div>

      {libraryLoading && library.length === 0 ? (
        <div className="author-panel-page__loading">
          <Spin size="small" />
        </div>
      ) : filteredLibrary.length === 0 ? (
        <AuthorPanelEmptyShell>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="扩展库为空。可通过其它入口写入扩展库，或打开「扩展库目录」手动添加。"
          />
        </AuthorPanelEmptyShell>
      ) : (
        <div className="app-my-extensions-panel__split">
          <div className="app-my-extensions-panel__left">
            <AuthorPanelListShell>
              <HubItems>
                {filteredLibrary.map((item) => {
                  const avatarColor = avatarColorFor(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`app-extensions-panel__card${activeLibraryId === item.id ? " app-my-extensions-panel__card--active" : ""}`}
                      style={{ ["--extension-avatar-color" as string]: avatarColor }}
                      onClick={() => selectLibraryItem(item.id)}
                    >
                      <HubItem
                        avatarText={item.name.slice(0, 1) || "·"}
                        avatarColor={avatarColor}
                        title={item.name}
                        tags={
                          <HubTag>
                            {kindIcon(item.kind)} {kindLabel(item.kind)}
                          </HubTag>
                        }
                        actions={
                          <Space
                            size={2}
                            className="app-my-extensions-panel__card-install-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Tooltip title="全局安装">
                              <Button
                                type="text"
                                size="small"
                                icon={<GlobalOutlined />}
                                loading={busyId === item.id}
                                onClick={() => void handleInstall(item, "global")}
                              />
                            </Tooltip>
                            <Tooltip title="安装到当前仓库">
                              <Button
                                type="text"
                                size="small"
                                icon={<CloudDownloadOutlined />}
                                disabled={!hasRepo}
                                loading={busyId === item.id}
                                onClick={() => void handleInstall(item, "repository")}
                              />
                            </Tooltip>
                          </Space>
                        }
                      />
                    </div>
                  );
                })}
              </HubItems>
            </AuthorPanelListShell>
          </div>
          <div className="app-my-extensions-panel__right">
            {!selectedItem ? (
              <AuthorPanelEmptyShell>
                <Empty description="请选择一个扩展库条目查看详情。" />
              </AuthorPanelEmptyShell>
            ) : (
              <div className="app-my-extensions-panel__detail">
                <div className="app-my-extensions-panel__detail-toolbar">
                  <Input
                    size="small"
                    className="app-my-extensions-panel__detail-name-input"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="扩展名称"
                  />
                  <Space size={4} wrap={false} className="app-my-extensions-panel__detail-toolbar-actions">
                    <Tooltip title="保存名称">
                      <Button
                        size="small"
                        icon={<SaveOutlined />}
                        loading={savingName}
                        onClick={() => void handleSaveName()}
                      />
                    </Tooltip>
                    <Tooltip title="保存内容">
                      <Button
                        size="small"
                        type="primary"
                        icon={<SaveOutlined />}
                        loading={savingContent}
                        disabled={!activeContent || editorDraft === activeContent.content}
                        onClick={() => void handleSaveContent()}
                      />
                    </Tooltip>
                    <Tooltip title="从扩展库删除">
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        loading={removingId === selectedItem.id}
                        onClick={() => handleRemove(selectedItem)}
                      />
                    </Tooltip>
                  </Space>
                </div>
                <div className="app-my-extensions-panel__workspace">
                  <ExtensionSnapshotTree
                    libraryItemId={selectedItem.id}
                    tree={snapshotTree}
                    loading={treeLoading}
                    selectedKey={activeFileKey}
                    onSelect={requestSelectFile}
                    onRefresh={loadSnapshotTree}
                  />
                  <div className="app-my-extensions-panel__editor-pane">
                    <Typography.Text
                      type="secondary"
                      className="app-my-extensions-panel__editor-path"
                      ellipsis
                      title={activeFileKey ?? undefined}
                    >
                      {kindLabel(selectedItem.kind)}
                      {activeFileKey ? ` · ${activeFileKey}` : ""}
                    </Typography.Text>
                    <div className="app-my-extensions-panel__editor">
                      {contentLoading ? (
                        <div className="author-panel-page__loading">
                          <Spin size="small" />
                        </div>
                      ) : !activeFileKey ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="选择左侧文件"
                        />
                      ) : (
                        <Suspense fallback={<Spin size="small" />}>
                          <MonacoEditor
                            key={`${selectedItem.id}:${activeFileKey}`}
                            className="app-my-extensions-panel__monaco"
                            height="100%"
                            language={activeContent?.language ?? "plaintext"}
                            value={editorDraft}
                            options={{
                              minimap: { enabled: false },
                              fontSize: 12,
                              lineHeight: 18,
                              padding: { top: 0, bottom: 4 },
                              wordWrap: "on",
                              scrollBeyondLastLine: false,
                              automaticLayout: true,
                              overviewRulerLanes: 0,
                              hideCursorInOverviewRuler: true,
                            }}
                            onChange={(v) => setEditorDraft(v ?? "")}
                          />
                        </Suspense>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AuthorPanelPageShell>
  );
}
