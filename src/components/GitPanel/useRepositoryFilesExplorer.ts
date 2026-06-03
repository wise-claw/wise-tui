import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { MouseEvent } from "react";
import type { MenuProps } from "antd";
import { message } from "antd";
import {
  createRepositoryDirectory,
  createRepositoryFile,
  deleteRepositoryEntry,
  listRepositoryExplorerChildren,
  searchRepositoryFiles,
  type RepositoryExplorerEntry,
} from "../../services/repositoryFiles";
import { openInFinder, openWorkspaceIn } from "../../services/repository";
import { joinRepositoryAbsolutePath } from "../../utils/repositoryPreviewBinary";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  MIN_EXPLORER_SEARCH_QUERY_LEN,
  type ExplorerSearchResultRow,
} from "./fileTree";
import { buildLazyRepositoryFileTree, pruneLoadedChildrenMap } from "./lazyExplorerTree";
import { shouldApplyExplorerLoadResult } from "./repositoryExplorerLoad";
import { sanitizeExplorerExpandedDirsForRestore } from "./repositoryExplorerSession";
import {
  normalizeRepositoryDirPath,
  resolveRepositoryDirToggleIntent,
} from "./repositoryExplorerToggle";
import {
  clampExplorerMenuPosition,
  explorerTargetDirForCreate,
  isMacLikePlatform,
  isWindowsPlatform,
  isWordOfficeDocumentPath,
  readExplorerExpandedFromSession,
  writeExplorerExpandedToSession,
} from "./explorerUtils";
import { yieldToPaint } from "./gitPanelUtils";
import {
  getCachedRepositoryExplorerRootChildren,
  setCachedRepositoryExplorerRootChildren,
} from "./repositoryExplorerEntryCache";
import { buildCaptureExtensionContextMenuItems } from "./captureExtensionContextMenu";
import {
  INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE,
  reduceRepositoryExplorerExpandState,
} from "./repositoryExplorerExpandState";
import type { ExplorerContextMenuState, ExplorerInlineCreateState } from "./types";

function searchPathsToRows(paths: string[]): ExplorerSearchResultRow[] {
  return paths.map((path) => {
    const slash = path.lastIndexOf("/");
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const parentPath = slash >= 0 ? path.slice(0, slash) : "";
    return { path, isDir: false, name, parentPath, score: 0 };
  });
}

interface UseRepositoryFilesExplorerInput {
  repositoryPath: string;
  search: string;
  onClearExplorerSearch?: () => void;
}

/**
 * Lazy repository file tree — see `.trellis/spec/frontend/directory-structure.md`.
 *
 * - `loadedChildrenByDir` ("" = root) is the only mutable cache; tree is useMemo-derived.
 * - `listRepositoryExplorerChildren` runs on user expand (`repositoryExplorerToggle.ts`).
 * - Session may restore expanded paths but never auto-fetches children on mount.
 * - Stale IPC results are dropped via `repositoryExplorerLoad.shouldApplyExplorerLoadResult`.
 */
export function useRepositoryFilesExplorer({
  repositoryPath,
  search,
  onClearExplorerSearch,
}: UseRepositoryFilesExplorerInput) {
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedRepositoryPath, setLoadedRepositoryPath] = useState(repositoryPath);
  const [loadedChildrenByDir, setLoadedChildrenByDir] = useState<
    Map<string, RepositoryExplorerEntry[]>
  >(() => new Map());
  const [loadingDirPath, setLoadingDirPath] = useState<string | null>(null);
  const [searchResultRows, setSearchResultRows] = useState<ExplorerSearchResultRow[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [expandState, dispatchExpand] = useReducer(
    reduceRepositoryExplorerExpandState,
    INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE,
  );
  const expandedDirs = expandState.dirs;
  const expandEpoch = expandState.epoch;
  const lastExpandPath = expandState.lastPath;
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null);
  const [inlineCreate, setInlineCreate] = useState<ExplorerInlineCreateState | null>(null);
  const [inlineRowKey, setInlineRowKey] = useState(0);
  const [explorerCtx, setExplorerCtx] = useState<ExplorerContextMenuState | null>(null);
  const [deletePop, setDeletePop] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
  } | null>(null);
  const inlineCreateRef = useRef<ExplorerInlineCreateState | null>(null);
  const explorerScanGenerationRef = useRef(0);
  const loadInFlightRef = useRef(new Set<string>());
  const loadedChildrenByDirRef = useRef(loadedChildrenByDir);
  const repositoryPathRef = useRef(repositoryPath);
  loadedChildrenByDirRef.current = loadedChildrenByDir;
  repositoryPathRef.current = repositoryPath;

  const treeStale = loadedRepositoryPath !== repositoryPath;
  const debouncedSearch = useDebouncedValue(search, 150);
  const searchQuery = debouncedSearch.trim();
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const explorerSearchPending = searchPending || deferredSearchQuery !== searchQuery;
  const explorerSearchTooShort =
    deferredSearchQuery.length > 0 && deferredSearchQuery.length < MIN_EXPLORER_SEARCH_QUERY_LEN;

  const hasRootLoaded = !treeStale && loadedChildrenByDir.has("");

  const filteredTree = useMemo(() => {
    if (treeStale || !loadedChildrenByDir.has("")) {
      return [];
    }
    return buildLazyRepositoryFileTree(loadedChildrenByDir);
  }, [loadedChildrenByDir, treeStale]);

  const prevSearchQueryRef = useRef("");
  useEffect(() => {
    const prev = prevSearchQueryRef.current;
    prevSearchQueryRef.current = searchQuery;
    if (prev && !searchQuery) {
      const restored = readExplorerExpandedFromSession(repositoryPath);
      if (restored?.size) {
        startTransition(() => {
          dispatchExpand({
            type: "replace",
            dirs: sanitizeExplorerExpandedDirsForRestore(restored),
          });
        });
      }
    }
  }, [repositoryPath, searchQuery]);

  const loadChildrenForDir = useCallback(
    async (dirPath: string, options?: { force?: boolean }) => {
      const normalizedDir = normalizeRepositoryDirPath(dirPath);
      const requestPath = repositoryPathRef.current.trim();
      if (!requestPath) {
        return;
      }
      if (!options?.force && loadedChildrenByDirRef.current.has(normalizedDir)) {
        return;
      }
      if (loadInFlightRef.current.has(normalizedDir)) {
        return;
      }
      const requestGeneration = explorerScanGenerationRef.current;
      loadInFlightRef.current.add(normalizedDir);
      setLoadingDirPath(normalizedDir);
      try {
        const children = await listRepositoryExplorerChildren(requestPath, normalizedDir);
        if (
          !shouldApplyExplorerLoadResult({
            requestGeneration,
            currentGeneration: explorerScanGenerationRef.current,
            requestRepositoryPath: requestPath,
            currentRepositoryPath: repositoryPathRef.current.trim(),
          })
        ) {
          return;
        }
        startTransition(() => {
          setLoadedChildrenByDir((prev) => {
            const next = new Map(prev);
            next.set(normalizedDir, children);
            return next;
          });
          if (normalizedDir === "") {
            setCachedRepositoryExplorerRootChildren(requestPath, children);
            setLoadedRepositoryPath(requestPath);
            setLoadError(null);
          }
        });
      } catch (error) {
        if (
          !shouldApplyExplorerLoadResult({
            requestGeneration,
            currentGeneration: explorerScanGenerationRef.current,
            requestRepositoryPath: requestPath,
            currentRepositoryPath: repositoryPathRef.current.trim(),
          })
        ) {
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        if (normalizedDir === "") {
          setLoadError(msg);
          setLoadedChildrenByDir(new Map());
        } else {
          message.error(`读取目录失败：${msg}`);
        }
      } finally {
        loadInFlightRef.current.delete(normalizedDir);
        setLoadingDirPath((current) => (current === normalizedDir ? null : current));
      }
    },
    [],
  );

  const reloadExplorer = useCallback(async () => {
    explorerScanGenerationRef.current += 1;
    loadInFlightRef.current.clear();
    setLoadingDirPath(null);
    setLoading(true);
    try {
      await yieldToPaint();
      setLoadedChildrenByDir(new Map());
      await loadChildrenForDir("", { force: true });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [loadChildrenForDir]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const dirs = expandedDirs;
      const path = repositoryPath;
      const persist = () => writeExplorerExpandedToSession(path, dirs);
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(persist, { timeout: 3000 });
      } else {
        persist();
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [repositoryPath, expandedDirs]);

  useEffect(() => {
    let cancelled = false;
    const path = repositoryPath.trim();
    if (!path) {
      setLoadedChildrenByDir(new Map());
      setLoadedRepositoryPath("");
      setLoadError(null);
      setIsRefreshing(false);
      setLoading(false);
      loadInFlightRef.current.clear();
      setLoadingDirPath(null);
      return;
    }
    setLoadError(null);
    explorerScanGenerationRef.current += 1;
    loadInFlightRef.current.clear();
    setLoadingDirPath(null);
    const generation = explorerScanGenerationRef.current;

    const cachedRoot = getCachedRepositoryExplorerRootChildren(path);
    const restoredExpanded = sanitizeExplorerExpandedDirsForRestore(
      readExplorerExpandedFromSession(path) ?? new Set(),
    );

    if (cachedRoot) {
      setLoadedChildrenByDir(new Map([["", cachedRoot]]));
      setLoadedRepositoryPath(path);
      dispatchExpand({ type: "replace", dirs: restoredExpanded });
      setSelected(null);
      setInlineCreate(null);
      setDeletePop(null);
      setIsRefreshing(false);
      setLoading(false);
    } else {
      setLoadedChildrenByDir(new Map());
      setLoadedRepositoryPath("");
      setLoading(true);
    }

    void (async () => {
      try {
        if (cachedRoot) {
          return;
        }
        const children = await listRepositoryExplorerChildren(path, "");
        if (
          !shouldApplyExplorerLoadResult({
            requestGeneration: generation,
            currentGeneration: explorerScanGenerationRef.current,
            requestRepositoryPath: path,
            currentRepositoryPath: repositoryPathRef.current.trim(),
            cancelled,
          })
        ) {
          return;
        }
        setCachedRepositoryExplorerRootChildren(path, children);
        startTransition(() => {
          setLoadedChildrenByDir(new Map([["", children]]));
          setLoadedRepositoryPath(path);
          dispatchExpand({ type: "replace", dirs: restoredExpanded });
          setLoadError(null);
        });
      } catch (error) {
        if (
          shouldApplyExplorerLoadResult({
            requestGeneration: generation,
            currentGeneration: explorerScanGenerationRef.current,
            requestRepositoryPath: path,
            currentRepositoryPath: repositoryPathRef.current.trim(),
            cancelled,
          })
        ) {
          const msg = error instanceof Error ? error.message : String(error);
          setLoadError(msg);
          setLoadedChildrenByDir(new Map());
          setLoadedRepositoryPath(path);
        }
      } finally {
        if (
          shouldApplyExplorerLoadResult({
            requestGeneration: generation,
            currentGeneration: explorerScanGenerationRef.current,
            requestRepositoryPath: path,
            currentRepositoryPath: repositoryPathRef.current.trim(),
            cancelled,
          })
        ) {
          setIsRefreshing(false);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      loadInFlightRef.current.clear();
      setLoadingDirPath(null);
    };
  }, [repositoryPath]);

  useEffect(() => {
    const path = repositoryPath.trim();
    const q = deferredSearchQuery;
    if (!path || !q || q.length < MIN_EXPLORER_SEARCH_QUERY_LEN) {
      setSearchResultRows([]);
      setSearchPending(false);
      return;
    }
    let cancelled = false;
    setSearchPending(true);
    void (async () => {
      try {
        const paths = await searchRepositoryFiles(path, q);
        if (cancelled) {
          return;
        }
        setSearchResultRows(searchPathsToRows(paths));
      } catch {
        if (!cancelled) {
          setSearchResultRows([]);
        }
      } finally {
        if (!cancelled) {
          setSearchPending(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deferredSearchQuery, repositoryPath]);

  useEffect(() => {
    inlineCreateRef.current = inlineCreate;
  }, [inlineCreate]);

  const expandedDirsRef = useRef(expandedDirs);
  expandedDirsRef.current = expandedDirs;

  const handleToggleDir = useCallback(
    (dirPath: string) => {
      const normalizedDir = normalizeRepositoryDirPath(dirPath);
      const intent = resolveRepositoryDirToggleIntent({
        isExpanded: expandedDirsRef.current.has(normalizedDir),
        childrenLoaded: loadedChildrenByDirRef.current.has(normalizedDir),
      });
      if (intent === "load-children-only") {
        void loadChildrenForDir(normalizedDir);
        return;
      }
      dispatchExpand({ type: "toggle", path: normalizedDir });
      if (intent === "expand-and-load") {
        void loadChildrenForDir(normalizedDir);
      }
    },
    [loadChildrenForDir],
  );

  const handleRefresh = useCallback(() => {
    void reloadExplorer();
  }, [reloadExplorer]);

  const handleCollapseAll = useCallback(() => {
    dispatchExpand({ type: "collapseAll" });
  }, []);

  const handleExplorerContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-repo-inline-create]")) {
      return;
    }
    const row = (event.target as HTMLElement).closest("[data-repo-path]");
    if (!row) {
      return;
    }
    event.preventDefault();
    const path = row.getAttribute("data-repo-path") ?? "";
    const isDir = row.getAttribute("data-repo-is-dir") === "1";
    const { x, y } = clampExplorerMenuPosition(event.clientX, event.clientY);
    setExplorerCtx({ x, y, path, isDir });
  }, []);

  const performDeletePath = useCallback(
    async (relativePath: string): Promise<boolean> => {
      try {
        await deleteRepositoryEntry(repositoryPath, relativePath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        message.error(`删除失败：${msg}`);
        return false;
      }
      startTransition(() => {
        setLoadedChildrenByDir((prev) => pruneLoadedChildrenMap(prev, relativePath));
      });
      const parentDir = relativePath.includes("/")
        ? relativePath.slice(0, relativePath.lastIndexOf("/"))
        : "";
      await loadChildrenForDir(parentDir, { force: true });
      setSelected((prev) => {
        if (!prev) {
          return prev;
        }
        if (prev.path === relativePath || prev.path.startsWith(`${relativePath}/`)) {
          return null;
        }
        return prev;
      });
      dispatchExpand({ type: "pruneSubtree", rootPath: relativePath });
      message.success("已删除");
      return true;
    },
    [loadChildrenForDir, repositoryPath],
  );

  const expandAncestorsForDir = useCallback(
    (parentDir: string) => {
      if (!parentDir) {
        return;
      }
      dispatchExpand({ type: "expandAncestors", parentDir });
      const parts = parentDir.split("/").filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        void loadChildrenForDir(acc);
      }
    },
    [loadChildrenForDir],
  );

  const openInlineCreate = useCallback(
    (type: "file" | "folder", parentDir: string) => {
      if (search.trim()) {
        onClearExplorerSearch?.();
      }
      expandAncestorsForDir(parentDir);
      setInlineRowKey((k) => k + 1);
      setInlineCreate({
        type,
        parentDir,
        value: type === "file" ? "新文件.txt" : "新建文件夹",
      });
    },
    [expandAncestorsForDir, onClearExplorerSearch, search],
  );

  const explorerContextMenuItems = useMemo((): MenuProps["items"] => {
    const snap = explorerCtx;
    if (!snap) {
      return [];
    }
    const close = () => setExplorerCtx(null);
    const targetForCreate = explorerTargetDirForCreate({
      path: snap.path,
      isDir: snap.isDir,
    });

    const abs = joinRepositoryAbsolutePath(repositoryPath, snap.path);
    const tryOpenWithApp = (label: string, appName: string) => () => {
      close();
      void openWorkspaceIn(abs, { appName }).catch((e) => {
        message.error(`${label} 打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };
    const tryOpenWithCommand = (label: string, command: string, args: string[] = []) => () => {
      close();
      void openWorkspaceIn(abs, { command, args }).catch((e) => {
        message.error(`${label} 打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };
    const openWithDefaultApp = () => {
      close();
      void openInFinder(abs).catch((e) => {
        message.error(`打开失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };

    const captureItems = buildCaptureExtensionContextMenuItems({
      repositoryPath,
      relativePath: snap.path,
      onClose: close,
      onSuccess: (name) => {
        message.success(`已录入扩展库：${name}`);
      },
      onError: (err) => {
        message.error(err);
      },
    });

    const standardItems: NonNullable<MenuProps["items"]> = [
      ...captureItems,
      {
        key: "nf",
        label: "新建文件",
        onClick: () => {
          close();
          openInlineCreate("file", targetForCreate);
        },
      },
      {
        key: "nd",
        label: "新建文件夹",
        onClick: () => {
          close();
          openInlineCreate("folder", targetForCreate);
        },
      },
      { type: "divider" },
      {
        key: "del",
        label: "删除",
        danger: true,
        onClick: (info) => {
          const ev = info.domEvent;
          if (!("clientX" in ev)) {
            close();
            return;
          }
          close();
          setDeletePop({
            x: ev.clientX,
            y: ev.clientY,
            path: snap.path,
            isDir: snap.isDir,
          });
        },
      },
    ];

    const isWordFile = !snap.isDir && isWordOfficeDocumentPath(snap.path);
    if (!isWordFile) {
      return standardItems;
    }

    return [
      { key: "ext-root", label: "在外部应用中打开", children: externalOpenItems(openWithDefaultApp, tryOpenWithApp, tryOpenWithCommand) },
      { type: "divider" },
      ...standardItems,
    ];
  }, [explorerCtx, repositoryPath, openInlineCreate]);

  const cancelInlineCreate = useCallback(() => {
    setInlineCreate(null);
  }, []);

  const handleToolbarNewFile = useCallback(() => {
    openInlineCreate("file", explorerTargetDirForCreate(selected));
  }, [openInlineCreate, selected]);

  const handleToolbarNewFolder = useCallback(() => {
    openInlineCreate("folder", explorerTargetDirForCreate(selected));
  }, [openInlineCreate, selected]);

  const expandAncestorDirs = useCallback((relativePath: string, isDir: boolean) => {
    const parts = relativePath.split("/").filter(Boolean);
    const dirDepth = isDir ? parts.length : Math.max(0, parts.length - 1);
    if (dirDepth === 0) {
      return;
    }
    const parentDir = parts.slice(0, dirDepth).join("/");
    dispatchExpand({ type: "expandAncestors", parentDir });
  }, []);

  const commitInlineCreate = useCallback(async () => {
    const cur = inlineCreateRef.current;
    if (!cur) {
      return;
    }
    const name = cur.value.trim();
    if (!name) {
      setInlineCreate(null);
      return;
    }
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      message.warning("名称不合法");
      return;
    }
    const relative = cur.parentDir ? `${cur.parentDir}/${name}` : name;
    try {
      if (cur.type === "file") {
        await createRepositoryFile(repositoryPath, relative);
      } else {
        await createRepositoryDirectory(repositoryPath, relative);
      }
      message.success("已创建");
      setInlineCreate(null);
      const parentDir = cur.parentDir;
      setLoadedChildrenByDir((prev) => {
        const next = new Map(prev);
        next.delete(parentDir || "");
        return next;
      });
      await loadChildrenForDir(parentDir || "", { force: true });
      expandAncestorDirs(relative, cur.type === "folder");
      setSelected({
        path: relative,
        isDir: cur.type === "folder",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`创建失败：${msg}`);
    }
  }, [expandAncestorDirs, loadChildrenForDir, repositoryPath]);

  const handleInlineValueChange = useCallback((value: string) => {
    setInlineCreate((prev) => (prev ? { ...prev, value } : null));
  }, []);

  const handleSelectNode = useCallback((path: string, isDir: boolean) => {
    setSelected({ path, isDir });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
  }, []);

  const handleInlineCommit = useCallback(() => {
    void commitInlineCreate();
  }, [commitInlineCreate]);

  return {
    loading,
    isRefreshing,
    loadError,
    treeStale,
    hasRootLoaded,
    loadingDirPath,
    expandedDirs,
    selected,
    inlineCreate,
    inlineRowKey,
    explorerCtx,
    setExplorerCtx,
    deletePop,
    setDeletePop,
    filteredTree,
    searchResultRows,
    explorerSearchTruncated: false,
    explorerSearchTooShort,
    explorerSearchPending,
    explorerContextMenuItems,
    handleToggleDir,
    expandEpoch,
    lastExpandPath,
    handleRefresh,
    handleCollapseAll,
    handleExplorerContextMenu,
    performDeletePath,
    handleToolbarNewFile,
    handleToolbarNewFolder,
    commitInlineCreate,
    handleInlineValueChange,
    handleSelectNode,
    clearSelection,
    handleInlineCommit,
    cancelInlineCreate,
  };
}

function externalOpenItems(
  openWithDefaultApp: () => void,
  tryOpenWithApp: (label: string, appName: string) => () => void,
  tryOpenWithCommand: (label: string, command: string, args?: string[]) => () => void,
): NonNullable<MenuProps["items"]> {
  if (isMacLikePlatform()) {
    return [
      { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
      { type: "divider" },
      { key: "ext-wps", label: "WPS Office", onClick: tryOpenWithApp("WPS Office", "WPS Office") },
      { key: "ext-word", label: "Microsoft Word", onClick: tryOpenWithApp("Microsoft Word", "Microsoft Word") },
      { key: "ext-pages", label: "Pages", onClick: tryOpenWithApp("Pages", "Pages") },
      { key: "ext-lo", label: "LibreOffice", onClick: tryOpenWithApp("LibreOffice", "LibreOffice") },
    ];
  }
  if (isWindowsPlatform()) {
    return [
      { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
      { type: "divider" },
      { key: "ext-wps", label: "WPS Office", onClick: tryOpenWithApp("WPS Office", "wps") },
      { key: "ext-word", label: "Microsoft Word", onClick: tryOpenWithApp("Microsoft Word", "WINWORD") },
    ];
  }
  return [
    { key: "ext-default", label: "用默认应用打开", onClick: openWithDefaultApp },
    { type: "divider" },
    { key: "ext-lo", label: "LibreOffice", onClick: tryOpenWithCommand("LibreOffice", "libreoffice") },
  ];
}
