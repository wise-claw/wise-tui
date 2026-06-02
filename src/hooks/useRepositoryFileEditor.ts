import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { message, Modal } from "antd";
import type { GitPanelOpenFileOptions } from "../components/GitPanel";
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
  content: string;
  originalContent: string;
  loading: boolean;
  focusLine?: number | null;
  /** Displayed with Monaco diff when present. */
  diffOriginal?: string;
  /** Git changes source; staged diffs are read-only. */
  gitDiffSection?: "staged" | "unstaged";
}

interface UseRepositoryFileEditorOptions {
  repositoryPath: string | null | undefined;
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
    async (relativePath: string) => {
      if (!repositoryPath) {
        message.warning("请先选择仓库");
        return;
      }
      const absPath = joinRepositoryAbsolutePath(repositoryPath, relativePath);

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
          const b64 = await readProjectRelativeFileBase64(repositoryPath, relativePath);
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
          const b64 = await readProjectRelativeFileBase64(repositoryPath, relativePath);
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
          const b64 = await readProjectRelativeFileBase64(repositoryPath, relativePath);
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
    async (relativePath: string) => {
      if (!repositoryPath) {
        message.warning("请先选择仓库");
        return;
      }
      try {
        const absPath = joinRepositoryAbsolutePath(repositoryPath, relativePath);
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
    async (relativePath: string, options?: { line?: number | null }) => {
      if (!repositoryPath) {
        message.warning("请先选择仓库");
        return;
      }
      if (!shouldOpenRepositoryFileInMonaco(relativePath)) {
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (existing && !existing.loading && existing.diffOriginal === undefined) {
        if (options?.line != null) {
          setFileEditorTabs((prev) =>
            prev.map((tab) =>
              tab.relativePath === relativePath ? { ...tab, focusLine: options.line ?? null } : tab,
            ),
          );
        }
        setFileEditorActivePath(relativePath);
        return;
      }

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
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
        const body = await readProjectRelativeFile(repositoryPath, relativePath);
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
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
        const absPath = joinRepositoryAbsolutePath(repositoryPath, relativePath);
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
    async (relativePath: string, section: GitPanelOpenFileOptions["fromGitChanges"]) => {
      if (!repositoryPath) {
        message.warning("请先选择仓库");
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
          left = await gitShowRevision(repositoryPath, `:${norm}`);
          right = await readProjectRelativeFile(repositoryPath, relativePath);
        } else {
          left = await gitShowRevision(repositoryPath, `HEAD:${norm}`);
          right = await gitShowRevision(repositoryPath, `:${norm}`);
        }
        if (loadGeneration !== gitDiffLoadGenerationRef.current) {
          return;
        }
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
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

  const openRepositoryFile = useCallback(
    (relativePath: string, opts?: GitPanelOpenFileOptions) => {
      if (isRepositoryBinaryPreviewPath(relativePath)) {
        void openRepositoryBinaryPreview(relativePath);
        return;
      }
      if (isRepositoryExternalDefaultAppPath(relativePath)) {
        void openRepositoryExternalFile(relativePath);
        return;
      }
      if (opts?.fromGitChanges) {
        void loadGitDiffFile(relativePath, opts.fromGitChanges);
        return;
      }
      void loadEditorFile(relativePath, { line: opts?.line ?? null });
    },
    [loadEditorFile, loadGitDiffFile, openRepositoryBinaryPreview, openRepositoryExternalFile],
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
    if (!repositoryPath || !fileEditorActivePath) {
      return;
    }
    const tab = fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath);
    if (!tab || tab.loading) {
      return;
    }
    if (tab.gitDiffSection === "staged") {
      message.info("暂存区与上一版本的对比为只读；要修改文件请在工作区编辑并保存。");
      return;
    }
    setEditorSaving(true);
    try {
      await writeProjectRelativeFile(repositoryPath, fileEditorActivePath, tab.content);
      setFileEditorTabs((prev) =>
        prev.map((t) =>
          t.relativePath === fileEditorActivePath ? { ...t, originalContent: t.content } : t,
        ),
      );
      message.success("文件已保存");
    } catch (error) {
      console.error("Failed to save file:", error);
      message.error(`保存失败：${fileEditorActivePath}`);
    } finally {
      setEditorSaving(false);
    }
  }, [repositoryPath, fileEditorActivePath, fileEditorTabs]);

  useEffect(() => {
    if (!repositoryPath) {
      setFileEditorTabs([]);
      setFileEditorActivePath(null);
      setEditorSaving(false);
    }
  }, [repositoryPath]);

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
