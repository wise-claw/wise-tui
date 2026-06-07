import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { message, Modal } from "antd";
import type { GitPanelOpenFileOptions } from "../components/GitPanel/types";
import { gitShowRevision } from "../services/git";
import {
  readProjectRelativeFile,
  readProjectRelativeFileBase64,
  writeProjectRelativeFile,
} from "../services/materializePrdSnapshot";
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
  const fileEditorTabsRef = useRef<FileEditorTab[]>([]);
  fileEditorTabsRef.current = fileEditorTabs;
  const gitDiffLoadGenerationRef = useRef(0);

  const editorVisible = fileEditorTabs.length > 0;
  const activeFileEditorTab = useMemo(
    () => fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath) ?? null,
    [fileEditorTabs, fileEditorActivePath],
  );
  const editorDirty = Boolean(
    activeFileEditorTab && activeFileEditorTab.content !== activeFileEditorTab.originalContent,
  );

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
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  rootPath,
                  content: body,
                  originalContent: body,
                  loading: false,
                  focusLine: options?.line ?? t.focusLine ?? null,
                }
              : t,
          ),
        );
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
    [repositoryPath],
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
    const dirtyCount = fileEditorTabs.filter((t) => t.content !== t.originalContent).length;
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
      const tab = fileEditorTabs.find((t) => t.relativePath === relativePath);
      if (!tab) {
        return;
      }
      if (tab.content !== tab.originalContent) {
        Modal.confirm({
          title: "关闭文件标签？",
          content: `「${relativePath}」有未保存修改，关闭后将丢失。`,
          okText: "仍要关闭",
          okType: "danger",
          cancelText: "取消",
          centered: true,
          onOk: () => {
            removeFileEditorTab(relativePath);
          },
        });
        return;
      }
      removeFileEditorTab(relativePath);
    },
    [fileEditorTabs, removeFileEditorTab],
  );

  const saveEditor = useCallback(async () => {
    if (!fileEditorActivePath) {
      return;
    }
    const tab = fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath);
    if (!tab || tab.loading) {
      return;
    }
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
    try {
      await writeProjectRelativeFile(rootPath, fileEditorActivePath, tab.content);
      setFileEditorTabs((prev) =>
        prev.map((t) =>
          t.relativePath === fileEditorActivePath ? { ...t, originalContent: t.content } : t,
        ),
      );
    } catch (error) {
      console.error("Failed to save file:", error);
      message.error(`保存失败：${fileEditorActivePath}`);
    } finally {
      setEditorSaving(false);
    }
  }, [fileEditorActivePath, fileEditorTabs]);

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
    repositoryBinaryPreview,
    saveEditor,
    setFileEditorActivePath,
    setFileEditorTabs,
  };
}
