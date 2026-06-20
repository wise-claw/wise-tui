import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { message, Modal } from "antd";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GitPanelOpenFileOptions } from "../components/GitPanel/types";
import { gitShowRevision } from "../services/git";
import {
  readProjectRelativeFile,
  readProjectRelativeFileBase64,
  writeProjectRelativeFile,
} from "../services/projectRelativeFiles";
import { base64ToArrayBuffer, joinRepositoryAbsolutePath } from "../utils/repositoryPreviewBinary";
import { openInFinder } from "../services/repository";
import {
  isDocxFilePath,
  isImageFilePath,
  isLegacyDocFilePath,
  isPdfFilePath,
  isRepositoryBinaryPreviewPath,
  isRepositoryExternalDefaultAppPath,
  mimeTypeForImagePath,
  shouldOpenRepositoryFileInMonaco,
  type RepositoryBinaryPreviewState,
} from "../utils/repositoryFilePreview";
import { toUiErrorMessage } from "../utils/appErrorMessage";
import {
  isMonacoLargeFileContent,
  MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS,
} from "../utils/monacoLargeFile";
import { safeUnlisten } from "../utils/safeTauriUnlisten";

/** 外部变更触发磁盘重读的合并节流间隔（毫秒）。git-changed 与窗口聚焦共用。 */
const EDITOR_EXTERNAL_REFRESH_THROTTLE_MS = 300;

export interface FileEditorTab {
  relativePath: string;
  rootPath: string;
  content: string;
  originalContent: string;
  loading: boolean;
  focusLine?: number | null;
  /** Displayed with Monaco diff when present. */
  diffOriginal?: string;
  /** Git changes source; staged diffs are read-only. */
  gitDiffSection?: "staged" | "unstaged";
  /** Historical commit diff; read-only. */
  gitCommitSha?: string;
  /** Compare two commits; read-only. */
  gitCommitCompare?: { baseSha: string; headSha: string };
  /** 文件被外部修改且当前 tab 有未保存修改；等待用户确认是否覆盖。 */
  externalChanged?: boolean;
  /** 文件被外部删除；保留内容供复制，提示用户关闭。 */
  externalDeleted?: boolean;
  /** 外部内容替换计数；自增时驱动大文件（非受控）编辑器重新注入内容。 */
  contentVersion?: number;
}

/**
 * 单个编辑器 tab 在外部磁盘刷新时的决策。抽为纯函数便于单测。
 * - skip：loading / diff 只读视图 / 正在保存，不处理。
 * - unchanged：磁盘未变。
 * - reload-clean：tab 干净（effectiveContent === originalContent），用磁盘内容覆盖。
 * - mark-external-changed：tab 脏（有未保存修改），磁盘已变，仅打标记、不动内容。
 * - external-deleted：文件被外部删除。
 * - clear-external-flag：磁盘又变回与 originalContent 一致，清除旧标记。
 */
export type EditorTabRefreshDecision =
  | { kind: "skip"; reason: "loading" | "diff" | "saving" }
  | { kind: "unchanged" }
  | { kind: "reload-clean"; disk: string }
  | { kind: "mark-external-changed" }
  | { kind: "external-deleted" }
  | { kind: "clear-external-flag" };

export function planEditorTabRefresh(args: {
  tab: FileEditorTab;
  /** 考虑了待写入防抖的当前有效内容（pendingTabContentRef ?? tab.content）。 */
  effectiveContent: string;
  /** 磁盘内容；null 表示读取失败（通常为文件被删除）。 */
  diskContent: string | null;
  isSaving: boolean;
}): EditorTabRefreshDecision {
  const { tab, effectiveContent, diskContent, isSaving } = args;
  if (tab.loading) return { kind: "skip", reason: "loading" };
  if (tab.diffOriginal !== undefined) return { kind: "skip", reason: "diff" };
  if (isSaving) return { kind: "skip", reason: "saving" };
  if (diskContent === null) return { kind: "external-deleted" };
  if (diskContent === tab.originalContent) {
    if (tab.externalChanged || tab.externalDeleted) {
      return { kind: "clear-external-flag" };
    }
    return { kind: "unchanged" };
  }
  // 磁盘已变：干净 tab 直接覆盖，脏 tab 仅打标记。
  if (effectiveContent === tab.originalContent) {
    return { kind: "reload-clean", disk: diskContent };
  }
  return { kind: "mark-external-changed" };
}

interface UseRepositoryFileEditorOptions {
  repositoryPath: string | null | undefined;
}

function resolveFileRootPath(
  repositoryPath: string | null | undefined,
  options?: GitPanelOpenFileOptions,
): string | null {
  const fromOptions = options?.fileRootPath?.trim() ?? "";
  if (fromOptions) return fromOptions;
  const fromDefault = repositoryPath?.trim() ?? "";
  return fromDefault || null;
}

function missingFileRootMessage(): void {
  message.warning("请先选择工作区或仓库");
}

export function useRepositoryFileEditor({ repositoryPath }: UseRepositoryFileEditorOptions) {
  const [fileEditorTabs, setFileEditorTabs] = useState<FileEditorTab[]>([]);
  const [fileEditorActivePath, setFileEditorActivePath] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [contentSyncVersion, setContentSyncVersion] = useState(0);
  const fileEditorTabsRef = useRef<FileEditorTab[]>([]);
  fileEditorTabsRef.current = fileEditorTabs;
  const gitDiffLoadGenerationRef = useRef(0);
  const pendingTabContentRef = useRef<Map<string, string>>(new Map());
  const tabContentDebounceRef = useRef<Map<string, number>>(new Map());
  const savingPathsRef = useRef<Set<string>>(new Set());
  const refreshGenerationRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingTabContent = useCallback((relativePath?: string) => {
    const paths = relativePath
      ? [relativePath]
      : Array.from(pendingTabContentRef.current.keys());
    if (paths.length === 0) return;
    setFileEditorTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (!paths.includes(tab.relativePath)) return tab;
        const timer = tabContentDebounceRef.current.get(tab.relativePath);
        if (timer != null) {
          window.clearTimeout(timer);
          tabContentDebounceRef.current.delete(tab.relativePath);
        }
        const pending = pendingTabContentRef.current.get(tab.relativePath);
        if (pending == null) return tab;
        pendingTabContentRef.current.delete(tab.relativePath);
        if (tab.content === pending) return tab;
        changed = true;
        return { ...tab, content: pending };
      });
      return changed ? next : prev;
    });
  }, []);

  const updateFileEditorTabContent = useCallback(
    (relativePath: string, content: string) => {
      if (!isMonacoLargeFileContent(content)) {
        pendingTabContentRef.current.delete(relativePath);
        const timer = tabContentDebounceRef.current.get(relativePath);
        if (timer != null) {
          window.clearTimeout(timer);
          tabContentDebounceRef.current.delete(relativePath);
        }
        setFileEditorTabs((prev) =>
          prev.map((tab) => (tab.relativePath === relativePath ? { ...tab, content } : tab)),
        );
        return;
      }

      pendingTabContentRef.current.set(relativePath, content);
      setContentSyncVersion((version) => version + 1);
      const existingTimer = tabContentDebounceRef.current.get(relativePath);
      if (existingTimer != null) {
        window.clearTimeout(existingTimer);
      }
      tabContentDebounceRef.current.set(
        relativePath,
        window.setTimeout(() => {
          tabContentDebounceRef.current.delete(relativePath);
          const pending = pendingTabContentRef.current.get(relativePath);
          if (pending == null) return;
          pendingTabContentRef.current.delete(relativePath);
          setFileEditorTabs((prev) =>
            prev.map((tab) =>
              tab.relativePath === relativePath ? { ...tab, content: pending } : tab,
            ),
          );
        }, MONACO_LARGE_FILE_CHANGE_DEBOUNCE_MS),
      );
    },
    [],
  );

  useEffect(
    () => () => {
      for (const timer of tabContentDebounceRef.current.values()) {
        window.clearTimeout(timer);
      }
      tabContentDebounceRef.current.clear();
      pendingTabContentRef.current.clear();
    },
    [],
  );

  const applyLoadedEditorContent = useCallback(
    (relativePath: string, rootPath: string, body: string, focusLine?: number | null) => {
      const apply = () => {
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  rootPath,
                  content: body,
                  originalContent: body,
                  loading: false,
                  focusLine: focusLine ?? t.focusLine ?? null,
                }
              : t,
          ),
        );
      };
      if (isMonacoLargeFileContent(body)) {
        startTransition(apply);
      } else {
        apply();
      }
    },
    [],
  );

  const editorVisible = fileEditorTabs.length > 0;
  const activeFileEditorTab = useMemo(
    () => fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath) ?? null,
    [fileEditorTabs, fileEditorActivePath],
  );
  const editorDirty = useMemo(() => {
    if (!activeFileEditorTab) return false;
    const effectiveContent =
      pendingTabContentRef.current.get(activeFileEditorTab.relativePath) ??
      activeFileEditorTab.content;
    return effectiveContent !== activeFileEditorTab.originalContent;
  }, [activeFileEditorTab, contentSyncVersion]);

  const [repositoryBinaryPreview, setRepositoryBinaryPreview] = useState<RepositoryBinaryPreviewState | null>(null);

  const closeRepositoryBinaryPreview = useCallback(() => {
    setRepositoryBinaryPreview((prev) => {
      if (prev?.kind === "pdf") {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return null;
    });
  }, []);

  const openRepositoryBinaryPreview = useCallback(
    async (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      const absPath = joinRepositoryAbsolutePath(rootPath, relativePath);

      if (isLegacyDocFilePath(relativePath)) {
        setRepositoryBinaryPreview((prev) => {
          if (prev?.kind === "pdf") {
            URL.revokeObjectURL(prev.blobUrl);
          }
          return { kind: "doc", relativePath, absolutePath: absPath };
        });
        return;
      }

      try {
        if (isImageFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(rootPath, relativePath);
          const mime = mimeTypeForImagePath(relativePath);
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "image", relativePath, src: `data:${mime};base64,${b64}` };
          });
          return;
        }
        if (isPdfFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(rootPath, relativePath);
          const buf = base64ToArrayBuffer(b64);
          const blob = new Blob([buf], { type: "application/pdf" });
          const blobUrl = URL.createObjectURL(blob);
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "pdf", relativePath, blobUrl };
          });
          return;
        }
        if (isDocxFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(rootPath, relativePath);
          const buf = base64ToArrayBuffer(b64);
          const mammoth = await import("mammoth");
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          const html = DOMPurify.sanitize(value, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["style", "script"],
          });
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "docx", relativePath, html };
          });
        }
      } catch (error) {
        console.error("Repository file preview failed:", error);
        message.error(`预览失败：${toUiErrorMessage(error)}`);
      }
    },
    [repositoryPath],
  );

  const openRepositoryExternalFile = useCallback(
    async (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      try {
        const absPath = joinRepositoryAbsolutePath(rootPath, relativePath);
        await openInFinder(absPath);
      } catch (error) {
        console.error("Open repository file externally failed:", error);
        message.error(`打开失败：${toUiErrorMessage(error)}`);
      }
    },
    [repositoryPath],
  );

  const removeFileEditorTab = useCallback((relativePath: string) => {
    setFileEditorTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.relativePath === relativePath);
      const nextTabs = prevTabs.filter((t) => t.relativePath !== relativePath);
      setFileEditorActivePath((cur) => {
        if (cur !== relativePath) {
          return cur;
        }
        if (nextTabs.length === 0) {
          return null;
        }
        return nextTabs[idx]?.relativePath ?? nextTabs[idx - 1]!.relativePath;
      });
      return nextTabs;
    });
  }, []);

  const loadEditorFile = useCallback(
    async (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      if (!shouldOpenRepositoryFileInMonaco(relativePath)) {
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (existing && !existing.loading && existing.diffOriginal === undefined) {
        setFileEditorTabs((prev) =>
          prev.map((tab) =>
            tab.relativePath === relativePath
              ? { ...tab, focusLine: options?.line ?? null, rootPath }
              : tab,
          ),
        );
        setFileEditorActivePath(relativePath);
        return;
      }

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          rootPath,
          content: "",
          originalContent: "",
          loading: true,
          focusLine: options?.line ?? null,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      try {
        const body = await readProjectRelativeFile(rootPath, relativePath);
        applyLoadedEditorContent(relativePath, rootPath, body, options?.line ?? null);
      } catch (error) {
        console.error("Failed to read file:", error);
        message.error(`读取文件失败：${relativePath}`);
        const absPath = joinRepositoryAbsolutePath(rootPath, relativePath);
        void openInFinder(absPath).catch(() => undefined);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [applyLoadedEditorContent, repositoryPath],
  );

  const loadGitDiffFile = useCallback(
    async (relativePath: string, section: GitPanelOpenFileOptions["fromGitChanges"], options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      if (!shouldOpenRepositoryFileInMonaco(relativePath)) {
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (
        existing &&
        existing.gitDiffSection === section &&
        !existing.loading &&
        existing.diffOriginal !== undefined
      ) {
        setFileEditorActivePath(relativePath);
        return;
      }

      const loadGeneration = ++gitDiffLoadGenerationRef.current;
      const norm = relativePath.replace(/\\/g, "/");

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          rootPath,
          content: "",
          originalContent: "",
          loading: true,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      try {
        let left = "";
        let right = "";
        if (section === "unstaged") {
          left = await gitShowRevision(rootPath, `:${norm}`);
          right = await readProjectRelativeFile(rootPath, relativePath);
        } else {
          left = await gitShowRevision(rootPath, `HEAD:${norm}`);
          right = await gitShowRevision(rootPath, `:${norm}`);
        }
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  rootPath,
                  content: right,
                  originalContent: right,
                  loading: false,
                  focusLine: null,
                  diffOriginal: left,
                  gitDiffSection: section,
                }
              : t,
          ),
        );
      } catch (error) {
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        console.error("Failed to load git diff:", error);
        message.error(`无法加载 diff：${relativePath}`);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [repositoryPath],
  );

  const loadCommitDiffFile = useCallback(
    async (relativePath: string, sha: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      if (!shouldOpenRepositoryFileInMonaco(relativePath)) {
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (
        existing &&
        existing.gitCommitSha === sha &&
        !existing.loading &&
        existing.diffOriginal !== undefined
      ) {
        setFileEditorActivePath(relativePath);
        return;
      }

      const loadGeneration = ++gitDiffLoadGenerationRef.current;
      const norm = relativePath.replace(/\\/g, "/");

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          rootPath,
          content: "",
          originalContent: "",
          loading: true,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      try {
        const left = await gitShowRevision(rootPath, `${sha}^:${norm}`);
        const right = await gitShowRevision(rootPath, `${sha}:${norm}`);
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  rootPath,
                  content: right,
                  originalContent: right,
                  loading: false,
                  focusLine: null,
                  diffOriginal: left,
                  gitCommitSha: sha,
                }
              : t,
          ),
        );
      } catch (error) {
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        console.error("Failed to load commit diff:", error);
        message.error(`无法加载提交 diff：${relativePath}`);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [repositoryPath],
  );

  const loadCommitCompareDiffFile = useCallback(
    async (relativePath: string, baseSha: string, headSha: string, options?: GitPanelOpenFileOptions) => {
      const rootPath = resolveFileRootPath(repositoryPath, options);
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      if (!shouldOpenRepositoryFileInMonaco(relativePath)) {
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (
        existing &&
        existing.gitCommitCompare?.baseSha === baseSha &&
        existing.gitCommitCompare?.headSha === headSha &&
        !existing.loading &&
        existing.diffOriginal !== undefined
      ) {
        setFileEditorActivePath(relativePath);
        return;
      }

      const loadGeneration = ++gitDiffLoadGenerationRef.current;
      const norm = relativePath.replace(/\\/g, "/");

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          rootPath,
          content: "",
          originalContent: "",
          loading: true,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      try {
        const left = await gitShowRevision(rootPath, `${baseSha}:${norm}`);
        const right = await gitShowRevision(rootPath, `${headSha}:${norm}`);
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  rootPath,
                  content: right,
                  originalContent: right,
                  loading: false,
                  focusLine: null,
                  diffOriginal: left,
                  gitCommitCompare: { baseSha, headSha },
                }
              : t,
          ),
        );
      } catch (error) {
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        console.error("Failed to load commit compare diff:", error);
        message.error(`无法加载对比 diff：${relativePath}`);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [repositoryPath],
  );

  const openRepositoryFile = useCallback(
    (relativePath: string, opts?: GitPanelOpenFileOptions) => {
      if (isRepositoryBinaryPreviewPath(relativePath)) {
        void openRepositoryBinaryPreview(relativePath, opts);
        return;
      }
      if (isRepositoryExternalDefaultAppPath(relativePath)) {
        void openRepositoryExternalFile(relativePath, opts);
        return;
      }
      if (opts?.fromCommitCompare) {
        void loadCommitCompareDiffFile(
          relativePath,
          opts.fromCommitCompare.baseSha,
          opts.fromCommitCompare.headSha,
          opts,
        );
        return;
      }
      if (opts?.fromCommit) {
        void loadCommitDiffFile(relativePath, opts.fromCommit.sha, opts);
        return;
      }
      if (opts?.fromGitChanges) {
        void loadGitDiffFile(relativePath, opts.fromGitChanges, opts);
        return;
      }
      void loadEditorFile(relativePath, opts);
    },
    [loadEditorFile, loadCommitCompareDiffFile, loadCommitDiffFile, loadGitDiffFile, openRepositoryBinaryPreview, openRepositoryExternalFile],
  );

  const closeFileEditorPanel = useCallback(() => {
    const dirtyCount = fileEditorTabsRef.current.filter((t) => {
      const effectiveContent = pendingTabContentRef.current.get(t.relativePath) ?? t.content;
      return effectiveContent !== t.originalContent;
    }).length;
    const clearAll = () => {
      setFileEditorTabs([]);
      setFileEditorActivePath(null);
      setEditorSaving(false);
    };
    if (dirtyCount === 0) {
      clearAll();
      return;
    }
    Modal.confirm({
      title: "关闭文件编辑面板？",
      content:
        dirtyCount === 1
          ? "当前有 1 个文件未保存，关闭后将丢失修改。"
          : `有 ${dirtyCount} 个文件未保存，关闭后将丢失修改。`,
      okText: "仍要关闭",
      okType: "danger",
      cancelText: "取消",
      centered: true,
      onOk: clearAll,
    });
  }, [fileEditorTabs]);

  const closeFileEditorTab = useCallback(
    (relativePath: string, e?: MouseEvent) => {
      e?.stopPropagation();
      const tab = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (!tab) {
        return;
      }
      const effectiveContent = pendingTabContentRef.current.get(relativePath) ?? tab.content;
      if (effectiveContent !== tab.originalContent) {
        Modal.confirm({
          title: "关闭文件标签？",
          content: `「${relativePath}」有未保存修改，关闭后将丢失。`,
          okText: "仍要关闭",
          okType: "danger",
          cancelText: "取消",
          centered: true,
          onOk: () => {
            flushPendingTabContent(relativePath);
            removeFileEditorTab(relativePath);
          },
        });
        return;
      }
      flushPendingTabContent(relativePath);
      removeFileEditorTab(relativePath);
    },
    [flushPendingTabContent, removeFileEditorTab],
  );

  const saveEditor = useCallback(async () => {
    if (!fileEditorActivePath) {
      return;
    }
    const tab = fileEditorTabsRef.current.find((t) => t.relativePath === fileEditorActivePath);
    if (!tab || tab.loading) {
      return;
    }
    const content = pendingTabContentRef.current.get(fileEditorActivePath) ?? tab.content;
    const rootPath = tab.rootPath.trim();
    if (!rootPath) {
      missingFileRootMessage();
      return;
    }
    if (tab.gitDiffSection === "staged") {
      message.info("暂存区与上一版本的对比为只读；要修改文件请在工作区编辑并保存。");
      return;
    }
    setEditorSaving(true);
    savingPathsRef.current.add(fileEditorActivePath);
    try {
      await writeProjectRelativeFile(rootPath, fileEditorActivePath, content);
      pendingTabContentRef.current.delete(fileEditorActivePath);
      const timer = tabContentDebounceRef.current.get(fileEditorActivePath);
      if (timer != null) {
        window.clearTimeout(timer);
        tabContentDebounceRef.current.delete(fileEditorActivePath);
      }
      setFileEditorTabs((prev) =>
        prev.map((t) =>
          t.relativePath === fileEditorActivePath
            ? {
                ...t,
                content,
                originalContent: content,
                externalChanged: false,
                externalDeleted: false,
              }
            : t,
        ),
      );
    } catch (error) {
      console.error("Failed to save file:", error);
      message.error(`保存失败：${fileEditorActivePath}`);
    } finally {
      savingPathsRef.current.delete(fileEditorActivePath);
      setEditorSaving(false);
    }
  }, [fileEditorActivePath]);

  /** 清掉指定 tab 待写入的防抖内容与定时器，用于外部刷新覆盖内容前避免残留 flush 覆盖。 */
  const discardTabPendingContent = useCallback((relativePath: string) => {
    pendingTabContentRef.current.delete(relativePath);
    const timer = tabContentDebounceRef.current.get(relativePath);
    if (timer != null) {
      window.clearTimeout(timer);
      tabContentDebounceRef.current.delete(relativePath);
    }
  }, []);

  /** 用磁盘内容覆盖一个干净 tab 的内容（含大文件 startTransition、contentVersion 自增）。 */
  const applyExternalDiskContent = useCallback(
    (relativePath: string, disk: string) => {
      discardTabPendingContent(relativePath);
      const apply = () => {
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  ...t,
                  content: disk,
                  originalContent: disk,
                  loading: false,
                  externalChanged: false,
                  externalDeleted: false,
                  contentVersion: (t.contentVersion ?? 0) + 1,
                }
              : t,
          ),
        );
      };
      if (isMonacoLargeFileContent(disk)) {
        startTransition(apply);
      } else {
        apply();
      }
    },
    [discardTabPendingContent],
  );

  /**
   * 刷新所有（或某仓库下）已打开的普通 tab，用磁盘最新内容对齐。
   * - 合并节流 EDITOR_EXTERNAL_REFRESH_THROTTLE_MS。
   * - 跳过 loading / diff 只读视图 / 正在保存的 tab。
   * - 干净 tab 静默覆盖；脏 tab 仅打 externalChanged 标记；删除打 externalDeleted。
   * 用 refreshGenerationRef 丢弃过期异步读结果，避免竞态覆盖。
   */
  const refreshOpenEditorTabsFromDisk = useCallback(
    (opts?: { repoPath?: string; trigger: "git-changed" | "focus" }) => {
      // 窗口隐藏时，git-changed 触发的刷新延迟到回焦统一处理。
      if (opts?.trigger === "git-changed" && typeof document !== "undefined" && document.hidden) {
        return;
      }
      if (refreshTimerRef.current != null) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        const generation = ++refreshGenerationRef.current;
        const repoPath = opts?.repoPath?.trim() ?? "";
        const snapshot = fileEditorTabsRef.current.filter((tab) => {
          if (tab.loading) return false;
          if (tab.diffOriginal !== undefined) return false;
          if (savingPathsRef.current.has(tab.relativePath)) return false;
          if (repoPath && tab.rootPath.trim() !== repoPath) return false;
          return true;
        });
        if (snapshot.length === 0) return;
        void Promise.allSettled(
          snapshot.map(async (tab) => {
            try {
              const disk = await readProjectRelativeFile(tab.rootPath, tab.relativePath);
              return { tab, disk: disk as string };
            } catch {
              return { tab, disk: null };
            }
          }),
        ).then((results) => {
          if (generation !== refreshGenerationRef.current) return;
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { tab, disk } = result.value;
            const effectiveContent =
              pendingTabContentRef.current.get(tab.relativePath) ?? tab.content;
            const decision = planEditorTabRefresh({
              tab,
              effectiveContent,
              diskContent: disk,
              isSaving: savingPathsRef.current.has(tab.relativePath),
            });
            if (decision.kind === "skip") continue;
            // apply 前再次校验：tab 可能已被关闭或切换为 diff 视图。
            const current = fileEditorTabsRef.current.find(
              (t) => t.relativePath === tab.relativePath,
            );
            if (!current || current.loading || current.diffOriginal !== undefined) continue;
            if (savingPathsRef.current.has(tab.relativePath)) continue;
            switch (decision.kind) {
              case "unchanged":
                continue;
              case "reload-clean":
                applyExternalDiskContent(tab.relativePath, decision.disk);
                continue;
              case "mark-external-changed":
                setFileEditorTabs((prev) =>
                  prev.map((t) =>
                    t.relativePath === tab.relativePath
                      ? { ...t, externalChanged: true, externalDeleted: false }
                      : t,
                  ),
                );
                continue;
              case "external-deleted":
                setFileEditorTabs((prev) =>
                  prev.map((t) =>
                    t.relativePath === tab.relativePath
                      ? { ...t, externalDeleted: true, externalChanged: false }
                      : t,
                  ),
                );
                continue;
              case "clear-external-flag":
                setFileEditorTabs((prev) =>
                  prev.map((t) =>
                    t.relativePath === tab.relativePath
                      ? { ...t, externalChanged: false, externalDeleted: false }
                      : t,
                  ),
                );
                continue;
              default:
                continue;
            }
          }
        });
      }, EDITOR_EXTERNAL_REFRESH_THROTTLE_MS);
    },
    [applyExternalDiskContent],
  );

  /** 用户点「重新加载」：强制用磁盘内容覆盖（即使 tab 脏）。 */
  const reloadEditorTabFromDisk = useCallback(
    async (relativePath: string) => {
      const tab = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (!tab || tab.loading) return;
      const rootPath = tab.rootPath.trim();
      if (!rootPath) {
        missingFileRootMessage();
        return;
      }
      try {
        const disk = await readProjectRelativeFile(rootPath, relativePath);
        const current = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
        if (!current || current.loading || current.diffOriginal !== undefined) return;
        applyExternalDiskContent(relativePath, disk);
      } catch (error) {
        console.error("Failed to reload file from disk:", error);
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? { ...t, externalDeleted: true, externalChanged: false }
              : t,
          ),
        );
        message.error(`重新加载失败：${relativePath}`);
      }
    },
    [applyExternalDiskContent],
  );

  // 监听后端文件系统变更事件（notify watcher 发出 git-changed），刷新所属仓库的已打开 tab。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<{ path?: string }>("git-changed", (event) => {
      const repoPath = event.payload?.path?.trim() ?? "";
      refreshOpenEditorTabsFromDisk({ repoPath, trigger: "git-changed" });
    })
      .then((fn) => {
        if (cancelled) {
          safeUnlisten(fn);
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* 非 Tauri 环境或监听失败，忽略；聚焦兜底仍可用 */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, [refreshOpenEditorTabsFromDisk]);

  // 窗口聚焦兜底：watcher 仅由 Git 面板启动，未挂载时无事件；回焦时直接重读磁盘刷新所有 tab。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        refreshOpenEditorTabsFromDisk({ trigger: "focus" });
      })
      .then((fn) => {
        if (cancelled) {
          safeUnlisten(fn);
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* 非 Tauri 测试环境忽略 */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, [refreshOpenEditorTabsFromDisk]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current != null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(
    () => () => {
      setRepositoryBinaryPreview((prev) => {
        if (prev?.kind === "pdf") {
          URL.revokeObjectURL(prev.blobUrl);
        }
        return null;
      });
    },
    [],
  );

  return {
    closeFileEditorPanel,
    closeFileEditorTab,
    closeRepositoryBinaryPreview,
    editorDirty,
    editorSaving,
    editorVisible,
    fileEditorActivePath,
    fileEditorTabs,
    openRepositoryFile,
    refreshOpenEditorTabsFromDisk,
    reloadEditorTabFromDisk,
    repositoryBinaryPreview,
    saveEditor,
    setFileEditorActivePath,
    setFileEditorTabs,
    updateFileEditorTabContent,
  };
}
