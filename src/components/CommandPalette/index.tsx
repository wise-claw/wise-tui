import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Input, Spin, TreeSelect, message } from "antd";
import { FolderOutlined, SearchOutlined } from "@ant-design/icons";
import { ExplorerTreeFileIcon } from "../GitPanel/explorerTreeChrome";
import { openRepositoryFileWithStoredPreference } from "../../services/openWorkspaceWithPreference";
import {
  listRepositoryExplorerChildren,
  searchRepositoryFileContents,
  searchRepositoryFiles,
} from "../../services/repositoryFiles";
import { highlightMatchSegments } from "./highlightMatch";
import {
  countContentFileGroupHits,
  groupContentMatchesByFile,
  type ContentFileGroup,
} from "./groupContentMatchesByFile";
import { commandPalettePropsEqual } from "./commandPalettePropsEqual";
import { getSearchHistoryStore, useSearchHistory } from "../../stores/searchHistoryStore";
import "./index.css";

export type CommandPaletteSearchMode = "filename" | "content";

/** filename 模式防抖：120ms 平衡响应感与 IPC 频率（原 50ms 在低端机几乎每键触发搜索）。 */
const FILENAME_SEARCH_DEBOUNCE_MS = 120;
/** content 模式防抖：全文搜索更重，保留更长防抖。 */
const CONTENT_SEARCH_DEBOUNCE_MS = 250;
interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath: string | undefined;
  /** 当前仓库 id，用于按仓库隔离搜索历史；null/undefined 时禁用历史记录。 */
  repositoryId?: number | null;
  searchMode: CommandPaletteSearchMode;
  onSearchModeChange: (mode: CommandPaletteSearchMode) => void;
  /** 文件树右键"在此搜索"预置的搜索范围（仓库相对目录）；undefined=整个仓库。 */
  initialScopeDir?: string;
  /** Enter / 单击：在 Wise 内打开仓库文件 */
  onOpenInApp: (relativePath: string, options?: { line?: number | null }) => void;
}

/** content 模式每个文件最多展示的匹配预览行数。 */
const MAX_CONTENT_HITS_PER_FILE = 12;

interface FilenameResult {
  kind: "filename";
  path: string;
  display: string;
}

type SearchResult = FilenameResult | ContentFileGroup;

const SEARCH_MODE_TABS: { mode: CommandPaletteSearchMode; label: string }[] = [
  { mode: "filename", label: "文件名" },
  { mode: "content", label: "文件内容" },
];

function CommandPaletteModeTabs({
  searchMode,
  onSearchModeChange,
}: {
  searchMode: CommandPaletteSearchMode;
  onSearchModeChange: (mode: CommandPaletteSearchMode) => void;
}) {
  return (
    <div className="app-command-palette-tabs" role="tablist" aria-label="搜索范围">
      {SEARCH_MODE_TABS.map(({ mode, label }) => {
        const active = searchMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            className={`app-command-palette-tab${active ? " app-command-palette-tab--active" : ""}`}
            onClick={() => onSearchModeChange(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CommandPaletteShortcutHints() {
  return (
    <div className="app-command-palette-shortcuts" aria-label="打开快捷键">
      <span className="app-command-palette-shortcut" title="在 Wise 内打开文件">
        <kbd className="app-command-palette-shortcut__keys">Enter</kbd>
        <span className="app-command-palette-shortcut__label">应用内</span>
      </span>
      <span className="app-command-palette-shortcut" title="按顶栏打开方式偏好在外部打开">
        <kbd className="app-command-palette-shortcut__keys">⇧Enter</kbd>
        <span className="app-command-palette-shortcut__label">外部</span>
      </span>
    </div>
  );
}

function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return { name: normalized, dir: "" };
  return { name: normalized.slice(idx + 1), dir: normalized.slice(0, idx) };
}

function formatSearchResultCount(results: SearchResult[]): string {
  if (results.length === 0) return "";
  const contentGroups = results.filter((item): item is ContentFileGroup => item.kind === "content-file");
  if (contentGroups.length !== results.length) {
    return `${results.length} 项结果`;
  }
  const hitCount = countContentFileGroupHits(contentGroups);
  if (hitCount === contentGroups.length) {
    return `${contentGroups.length} 个文件`;
  }
  return `${contentGroups.length} 个文件 · ${hitCount} 处匹配`;
}

/** 目录范围选择树节点（仅目录，懒加载子目录）。 */
interface ScopeTreeNode {
  title: string;
  value: string;
  isLeaf?: boolean;
  children?: ScopeTreeNode[];
}

/** 递归地把 `children` 挂到 value 等于 `targetValue` 的节点下（不可变更新）。 */
function setChildrenAt(
  nodes: ScopeTreeNode[],
  targetValue: string,
  children: ScopeTreeNode[],
): ScopeTreeNode[] {
  return nodes.map((n) => {
    if (n.value === targetValue) {
      return { ...n, children };
    }
    if (n.children) {
      return { ...n, children: setChildrenAt(n.children, targetValue, children) };
    }
    return n;
  });
}

const PreviewWithHighlight = memo(function PreviewWithHighlight({
  preview,
  matchStart,
  matchEnd,
  query,
}: {
  preview: string;
  matchStart?: number | null;
  matchEnd?: number | null;
  query: string;
}) {
  const segs = highlightMatchSegments(preview, matchStart, matchEnd, query);
  if (!segs) return <>{preview}</>;
  return (
    <>
      {segs.before}
      <mark>{segs.match}</mark>
      {segs.after}
    </>
  );
});

export const CommandPalette = memo(function CommandPalette({
  open,
  onClose,
  repositoryPath,
  repositoryId,
  searchMode,
  onSearchModeChange,
  initialScopeDir,
  onOpenInApp,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  /** 文件内容搜索的目录范围（仓库相对路径，空串=整个仓库）。 */
  const [scopeDir, setScopeDir] = useState("");
  const [scopeTreeData, setScopeTreeData] = useState<ScopeTreeNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestIdRef = useRef(0);
  // 键盘监听用 ref 持有可变值，避免 results/activeIndex 每次变化都重绑全局 keydown。
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // 最近打开文件历史：按仓库隔离，query 为空时在结果区展示最近打开的文件，点击/Enter 直接打开。
  const searchHistoryStore = useMemo(
    () => getSearchHistoryStore(repositoryId ?? null),
    [repositoryId],
  );
  const history = useSearchHistory(repositoryId ?? null, searchMode);
  // 打开文件时记录到最近文件历史（path 规范化与去重在数据层完成）。
  const recordSearchHistory = useCallback(
    (path: string, line?: number | null) => {
      if (repositoryId == null) return;
      void searchHistoryStore.add(searchMode, path, line);
    },
    [searchHistoryStore, searchMode, repositoryId],
  );
  // 无结果且无 query 时展示历史列表（footer 与键盘导航共用该判定）。
  const showingHistory = results.length === 0 && !query && history.length > 0;

  const loadScopeChildren = useCallback(
    async (parentDir: string): Promise<ScopeTreeNode[]> => {
      if (!repositoryPath) return [];
      const entries = await listRepositoryExplorerChildren(repositoryPath, parentDir);
      return entries
        .filter((e) => e.isDir)
        .map((e) => {
          const name = e.path.split("/").pop() || e.path;
          return { title: name, value: e.path, isLeaf: false };
        });
    },
    [repositoryPath],
  );

  const onLoadScopeTreeData = useCallback(
    async (node: { value?: string | number | null }) => {
      const parentDir = typeof node?.value === "string" ? node.value : "";
      const children = await loadScopeChildren(parentDir);
      setScopeTreeData((prev) => setChildrenAt(prev, parentDir, children));
    },
    [loadScopeChildren],
  );

  const openContentFileInApp = useCallback(
    (path: string, line?: number) => {
      if (!repositoryPath) return;
      onClose();
      onOpenInApp(path, line != null ? { line } : undefined);
    },
    [repositoryPath, onClose, onOpenInApp],
  );

  const openContentFileExternal = useCallback(
    (path: string, line?: number) => {
      if (!repositoryPath) return;
      onClose();
      void openRepositoryFileWithStoredPreference(
        repositoryPath,
        path,
        undefined,
        line != null ? { line } : undefined,
      ).catch((e) => {
        message.error(e instanceof Error ? e.message : String(e));
      });
    },
    [repositoryPath, onClose],
  );

  const openSearchResultInApp = useCallback(
    (item: SearchResult) => {
      if (!repositoryPath) return;
      if (item.kind === "content-file") {
        recordSearchHistory(item.path, item.hits[0]?.line);
        openContentFileInApp(item.path, item.hits[0]?.line);
        return;
      }
      recordSearchHistory(item.path);
      onClose();
      onOpenInApp(item.path);
    },
    [repositoryPath, onClose, onOpenInApp, openContentFileInApp, recordSearchHistory],
  );

  const openSearchResultExternal = useCallback(
    (item: SearchResult) => {
      if (!repositoryPath) return;
      if (item.kind === "content-file") {
        recordSearchHistory(item.path, item.hits[0]?.line);
        openContentFileExternal(item.path, item.hits[0]?.line);
        return;
      }
      recordSearchHistory(item.path);
      onClose();
      void openRepositoryFileWithStoredPreference(repositoryPath, item.path).catch((e) => {
        message.error(e instanceof Error ? e.message : String(e));
      });
    },
    [repositoryPath, onClose, openContentFileExternal, recordSearchHistory],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setResults([]);
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [open, searchMode]);

  // 打开搜索面板时初始化目录范围树与初始 scope：
  // - 默认整个仓库；initialScopeDir（文件树右键"在此搜索"预置）非空时限定到该目录。
  // - 两种搜索模式（文件名 / 内容）共用同一目录范围选择器。
  useEffect(() => {
    if (!open) return;
    setScopeDir(initialScopeDir ?? "");
    setScopeTreeData([{ title: "整个仓库", value: "", isLeaf: false, children: [] }]);
    let cancelled = false;
    void loadScopeChildren("").then((children) => {
      if (cancelled) return;
      setScopeTreeData((prev) => setChildrenAt(prev, "", children));
    });
    return () => {
      cancelled = true;
    };
  }, [open, initialScopeDir, loadScopeChildren]);

  useEffect(() => {
    if (!open || !repositoryPath) {
      setResults([]);
      setLoading(false);
      return;
    }
    const q = query.trim();
    // 抹掉所有前导 `/`，把 `/core/index` / `///core/index` 都退化为 `core/index`，
    // 与仓库相对路径表达方式对齐；抹完后为空（仅 `/` / 纯空白）则按空查询短路。
    const normalizedQuery = q.replace(/^\/+/, "");
    if (!normalizedQuery) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        if (searchMode === "filename") {
          const entries = await searchRepositoryFiles(
            repositoryPath,
            normalizedQuery,
            scopeDir || undefined,
          );
          if (cancelled || requestId !== searchRequestIdRef.current) return;
          setResults(
            entries.map((entry) => ({
              kind: "filename" as const,
              path: entry.path,
              display: entry.path,
            })),
          );
        } else {
          const matches = await searchRepositoryFileContents(
            repositoryPath,
            normalizedQuery,
            scopeDir || undefined,
          );
          if (cancelled || requestId !== searchRequestIdRef.current) return;
          setResults(groupContentMatchesByFile(matches));
        }
      } catch {
        if (!cancelled && requestId === searchRequestIdRef.current) setResults([]);
      } finally {
        if (!cancelled && requestId === searchRequestIdRef.current) setLoading(false);
      }
    }, searchMode === "content" ? CONTENT_SEARCH_DEBOUNCE_MS : FILENAME_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, repositoryPath, searchMode, scopeDir]);

  useEffect(() => {
    if (!open) return;

    // 无结果且无 query 时展示搜索历史，键盘导航 / Enter 在历史与结果间共用 activeIndex。
    const listLen = results.length > 0 ? results.length : showingHistory ? history.length : 0;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (listLen > 0 ? Math.min(i + 1, listLen - 1) : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (listLen > 0 ? Math.max(i - 1, 0) : 0));
      } else if (e.key === "Enter") {
        if (results.length > 0) {
          const item = results[activeIndex];
          if (item && repositoryPath) {
            e.preventDefault();
            if (e.shiftKey) {
              openSearchResultExternal(item);
            } else {
              openSearchResultInApp(item);
            }
          }
        } else if (showingHistory) {
          const entry = history[activeIndex];
          if (entry) {
            e.preventDefault();
            // 直接打开该最近文件（content 模式带行号定位）。
            openContentFileInApp(entry.path, entry.line ?? undefined);
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    results,
    activeIndex,
    history,
    showingHistory,
    onClose,
    repositoryPath,
    openSearchResultInApp,
    openSearchResultExternal,
    openContentFileInApp,
  ]);

  const placeholder =
    searchMode === "filename"
      ? "输入文件名或路径，如 core/index"
      : "搜索文件内容";
  const emptyHint =
    searchMode === "filename"
      ? "输入文件名或路径搜索，支持多级目录如 /core/index"
      : "输入关键词搜索文件内容";
  const dialogLabel = searchMode === "filename" ? "文件搜索" : "文件内容搜索";

  if (!open) return null;

  return (
    <div className="app-command-palette-backdrop" onClick={onClose}>
      <div
        className="app-command-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={dialogLabel}
      >
        <div className="app-command-palette-header">
          <CommandPaletteModeTabs searchMode={searchMode} onSearchModeChange={onSearchModeChange} />
          <div className="app-command-palette-scope">
            <TreeSelect
              value={scopeDir || undefined}
              onChange={(v) => setScopeDir(typeof v === "string" ? v : "")}
              treeData={scopeTreeData}
              loadData={onLoadScopeTreeData}
              placeholder="搜索范围：整个仓库"
              showSearch
              treeNodeFilterProp="title"
              allowClear
              size="small"
              variant="borderless"
              suffixIcon={<FolderOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />}
              style={{ width: "100%" }}
              dropdownStyle={{ maxHeight: 400, overflow: "auto" }}
              listHeight={320}
            />
          </div>
        </div>
        <div className="app-command-palette-input">
          <Input
            ref={inputRef as any}
            prefix={<SearchOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            variant="borderless"
            placeholder={placeholder}
            autoFocus
          />
        </div>
        {loading && query ? (
          <div className="app-command-palette-loading">
            <Spin size="small" />
          </div>
        ) : results.length > 0 ? (
          <div className="app-command-palette-list">
            {results.map((item, index) => {
              const isContentFile = item.kind === "content-file";
              const fileParts = isContentFile ? splitFilePath(item.path) : null;
              const visibleHits = isContentFile ? item.hits.slice(0, MAX_CONTENT_HITS_PER_FILE) : [];
              const overflowHitCount = isContentFile
                ? Math.max(0, item.hits.length - visibleHits.length)
                : 0;
              return (
              <div
                key={isContentFile ? item.path : item.path}
                className={`app-command-palette-item${isContentFile ? " app-command-palette-item--content" : ""} ${index === activeIndex ? "app-command-palette-item--active" : ""}`}
                onClick={() => {
                  openSearchResultInApp(item);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                  {isContentFile && fileParts ? (
                    <div className="app-command-palette-item-content">
                      <div className="app-command-palette-item-head">
                        <div className="app-command-palette-item-head-left">
                          <ExplorerTreeFileIcon
                            fileName={fileParts.name}
                            className="app-command-palette-item-file-icon"
                          />
                          <span className="app-command-palette-item-name">{fileParts.name}</span>
                        </div>
                        <span className="app-command-palette-item-head-right">
                          {fileParts.dir ? (
                            <span className="app-command-palette-item-dir">{fileParts.dir}</span>
                          ) : null}
                          {item.hits.length > 1 ? (
                            <span className="app-command-palette-item-hit-count">{item.hits.length} 处</span>
                          ) : null}
                        </span>
                      </div>
                      <div className="app-command-palette-item-hits">
                        {visibleHits.map((hit) => (
                          <div
                            key={hit.line}
                            className="app-command-palette-item-preview-row"
                            onClick={(event) => {
                              event.stopPropagation();
                              recordSearchHistory(item.path, hit.line);
                              openContentFileInApp(item.path, hit.line);
                            }}
                          >
                            <span className="app-command-palette-item-preview-line">:{hit.line}</span>
                            <span className="app-command-palette-item-preview-text">
                              <PreviewWithHighlight
                                preview={hit.preview}
                                matchStart={hit.matchStart}
                                matchEnd={hit.matchEnd}
                                query={query}
                              />
                            </span>
                          </div>
                        ))}
                        {overflowHitCount > 0 ? (
                          <div className="app-command-palette-item-preview-more">
                            还有 {overflowHitCount} 处匹配未显示
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : item.kind === "filename" ? (
                    <span className="app-command-palette-item-label">
                      <ExplorerTreeFileIcon
                        fileName={splitFilePath(item.path).name}
                        className="app-command-palette-item-file-icon"
                      />
                      <span className="app-command-palette-item-name">{splitFilePath(item.path).name}</span>
                      {splitFilePath(item.path).dir ? <span className="app-command-palette-item-dir"> &mdash; {splitFilePath(item.path).dir}</span> : null}
                    </span>
                  ) : null}
              </div>
            );
            })}
          </div>
        ) : query ? (
          <div className="app-command-palette-empty">
            {searchMode === "filename" ? "没有找到文件" : "没有找到匹配内容"}
          </div>
        ) : history.length > 0 ? (
          <div className="app-command-palette-list app-command-palette-history">
            <div className="app-command-palette-history-title">最近打开的文件</div>
            {history.map((entry, index) => {
              const parts = splitFilePath(entry.path);
              return (
                <div
                  key={`${entry.path}-${entry.timestamp}`}
                  className={`app-command-palette-item app-command-palette-history-item${index === activeIndex ? " app-command-palette-item--active" : ""}`}
                  onClick={() => {
                    openContentFileInApp(entry.path, entry.line ?? undefined);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="app-command-palette-history-info">
                    <ExplorerTreeFileIcon
                      fileName={parts.name}
                      className="app-command-palette-item-file-icon"
                    />
                    <span className="app-command-palette-history-name">{parts.name}</span>
                    {parts.dir ? (
                      <span className="app-command-palette-history-dir">{parts.dir}</span>
                    ) : null}
                    {typeof entry.line === "number" ? (
                      <span className="app-command-palette-history-line">:{entry.line}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="app-command-palette-history-remove"
                    aria-label="删除该记录"
                    title="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      void searchHistoryStore.remove(searchMode, entry.path);
                      setActiveIndex(0);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="app-command-palette-empty">{emptyHint}</div>
        )}
        <div className="app-command-palette-footer">
          {showingHistory ? (
            <button
              type="button"
              className="app-command-palette-footer-action"
              onClick={() => {
                void searchHistoryStore.clear(searchMode);
              }}
            >
              清空历史
            </button>
          ) : (
            <CommandPaletteShortcutHints />
          )}
          <span className="app-command-palette-footer-count">
            {loading && query ? "搜索中…" : formatSearchResultCount(results)}
          </span>
        </div>
      </div>
    </div>
  );
}, commandPalettePropsEqual);
