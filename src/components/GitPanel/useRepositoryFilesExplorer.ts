import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { MenuProps } from "antd";
import { message } from "antd";
import {
  createRepositoryDirectory,
  createRepositoryFile,
  deleteRepositoryEntry,
  listRepositoryExplorerEntries,
  type RepositoryExplorerEntry,
} from "../../services/repositoryFiles";
import { openInFinder, openWorkspaceIn } from "../../services/repository";
import { joinRepositoryAbsolutePath } from "../../utils/repositoryPreviewBinary";
import { buildRepositoryFileTree, collectDirectoryPaths, filterRepositoryTree } from "./fileTree";
import {
  clampExplorerMenuPosition,
  explorerTargetDirForCreate,
  isMacLikePlatform,
  isWindowsPlatform,
  isWordOfficeDocumentPath,
  readExplorerExpandedFromSession,
  writeExplorerExpandedToSession,
} from "./explorerUtils";
import { deferAfterPaint, yieldToPaint } from "./gitPanelUtils";
import {
  getCachedRepositoryExplorerEntries,
  setCachedRepositoryExplorerEntries,
} from "./repositoryExplorerEntryCache";
import { buildCaptureExtensionContextMenuItems } from "./captureExtensionContextMenu";
import type { ExplorerContextMenuState, ExplorerInlineCreateState } from "./types";

const EMPTY_REPOSITORY_EXPLORER_ENTRIES: RepositoryExplorerEntry[] = [];

interface UseRepositoryFilesExplorerInput {
  repositoryPath: string;
  search: string;
  onClearExplorerSearch?: () => void;
}

export function useRepositoryFilesExplorer({
  repositoryPath,
  search,
  onClearExplorerSearch,
}: UseRepositoryFilesExplorerInput) {
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadedRepositoryPath, setLoadedRepositoryPath] = useState(repositoryPath);
  const [explorerEntries, setExplorerEntries] = useState<RepositoryExplorerEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
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

  const treeStale = loadedRepositoryPath !== repositoryPath;
  const visibleExplorerEntries = treeStale ? EMPTY_REPOSITORY_EXPLORER_ENTRIES : explorerEntries;
  const tree = useMemo(() => buildRepositoryFileTree(visibleExplorerEntries), [visibleExplorerEntries]);
  const filteredTree = useMemo(() => filterRepositoryTree(tree, search), [tree, search]);

  const reloadExplorer = useCallback(
    async (options: { expandAll: boolean }) => {
      setLoading(true);
      try {
        await yieldToPaint();
        const entries = await listRepositoryExplorerEntries(repositoryPath);
        setCachedRepositoryExplorerEntries(repositoryPath, entries);
        startTransition(() => {
          setExplorerEntries(entries);
          setLoadedRepositoryPath(repositoryPath);
        });
        if (options.expandAll) {
          const allDirs = new Set<string>();
          collectDirectoryPaths(buildRepositoryFileTree(entries), allDirs);
          setExpandedDirs(allDirs);
        }
      } finally {
        setLoading(false);
      }
    },
    [repositoryPath],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeExplorerExpandedToSession(repositoryPath, expandedDirs);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [repositoryPath, expandedDirs]);

  useEffect(() => {
    let cancelled = false;
    const path = repositoryPath;
    const cached = getCachedRepositoryExplorerEntries(path);
    if (cached) {
      setExplorerEntries(cached);
      setLoadedRepositoryPath(path);
      setExpandedDirs(readExplorerExpandedFromSession(path) ?? new Set());
      setSelected(null);
      setInlineCreate(null);
      setDeletePop(null);
      setIsRefreshing(false);
      setLoading(false);
    } else {
      setIsRefreshing(true);
    }

    const applyEntries = (entries: RepositoryExplorerEntry[]) => {
      if (cancelled) {
        return;
      }
      setCachedRepositoryExplorerEntries(path, entries);
      startTransition(() => {
        setExplorerEntries(entries);
        setLoadedRepositoryPath(path);
      });
      if (!cached) {
        const restored = readExplorerExpandedFromSession(path);
        setExpandedDirs(restored ?? new Set());
        setSelected(null);
        setInlineCreate(null);
        setDeletePop(null);
      }
    };

    const cancelDeferredLoad = deferAfterPaint(() => {
      void (async () => {
        try {
          const entries = await listRepositoryExplorerEntries(path);
          applyEntries(entries);
        } finally {
          if (!cancelled) {
            setIsRefreshing(false);
            setLoading(false);
          }
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelDeferredLoad();
    };
  }, [repositoryPath]);

  useEffect(() => {
    if (!search.trim()) {
      return;
    }
    const matchedDirs = new Set<string>();
    collectDirectoryPaths(filteredTree, matchedDirs);
    setExpandedDirs((prev) => new Set([...prev, ...matchedDirs]));
  }, [search, filteredTree]);

  useEffect(() => {
    inlineCreateRef.current = inlineCreate;
  }, [inlineCreate]);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    void reloadExplorer({ expandAll: false });
  }, [reloadExplorer]);

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set());
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
      await reloadExplorer({ expandAll: false });
      setSelected((prev) => {
        if (!prev) {
          return prev;
        }
        if (prev.path === relativePath || prev.path.startsWith(`${relativePath}/`)) {
          return null;
        }
        return prev;
      });
      setExpandedDirs((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === relativePath || p.startsWith(`${relativePath}/`)) {
            continue;
          }
          next.add(p);
        }
        return next;
      });
      message.success("已删除");
      return true;
    },
    [reloadExplorer, repositoryPath],
  );

  const expandAncestorsForDir = useCallback((parentDir: string) => {
    if (!parentDir) {
      return;
    }
    const parts = parentDir.split("/").filter(Boolean);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        next.add(acc);
      }
      return next;
    });
  }, []);

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
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (let i = 0; i < dirDepth; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
        next.add(acc);
      }
      return next;
    });
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
      await reloadExplorer({ expandAll: false });
      expandAncestorDirs(relative, cur.type === "folder");
      setSelected({
        path: relative,
        isDir: cur.type === "folder",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`创建失败：${msg}`);
    }
  }, [expandAncestorDirs, reloadExplorer, repositoryPath]);

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
    treeStale,
    explorerEntries: visibleExplorerEntries,
    expandedDirs,
    selected,
    inlineCreate,
    inlineRowKey,
    explorerCtx,
    setExplorerCtx,
    deletePop,
    setDeletePop,
    filteredTree,
    explorerContextMenuItems,
    handleToggleDir,
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
