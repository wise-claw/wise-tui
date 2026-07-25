import { describe, expect, test } from "bun:test";
import {
  repositoryFileEditorTabSurfacePropsEqual,
  type RepositoryFileEditorTabSurfaceProps,
} from "./RepositoryFileEditorTabSurface";
import type { FileEditorTab } from "../hooks/useRepositoryFileEditor";
import { MONACO_LARGE_FILE_CHAR_THRESHOLD } from "../utils/monacoLargeFile";

function makeTab(overrides: Partial<FileEditorTab> = {}): FileEditorTab {
  return {
    relativePath: "src/a.ts",
    rootPath: "/repo",
    content: "hello",
    originalContent: "hello",
    loading: false,
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<RepositoryFileEditorTabSurfaceProps> = {},
): RepositoryFileEditorTabSurfaceProps {
  const noop = () => undefined;
  return {
    tab: makeTab(),
    isActive: false,
    dark: false,
    repositoryPath: "/repo",
    activeSessionId: null,
    onTabContentChange: noop,
    onCloseTab: noop,
    onReloadTab: noop,
    keepAlive: true,
    mdPreviewRequested: false,
    onMdPreviewRequestedChange: noop,
    ...overrides,
  };
}

describe("repositoryFileEditorTabSurfacePropsEqual", () => {
  test("非活跃大文件忽略 content 引用变化（同 length）", () => {
    const large = "x".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD);
    const prev = makeProps({
      isActive: false,
      tab: makeTab({ content: large, originalContent: large, contentVersion: 1 }),
    });
    const next = makeProps({
      isActive: false,
      tab: makeTab({ content: large.slice(), originalContent: large, contentVersion: 1 }),
      onTabContentChange: prev.onTabContentChange,
      onCloseTab: prev.onCloseTab,
      onReloadTab: prev.onReloadTab,
      onMdPreviewRequestedChange: prev.onMdPreviewRequestedChange,
    });
    expect(repositoryFileEditorTabSurfacePropsEqual(prev, next)).toBe(true);
  });

  test("contentVersion 变化仍触发更新", () => {
    const large = "x".repeat(MONACO_LARGE_FILE_CHAR_THRESHOLD);
    const prev = makeProps({
      isActive: false,
      tab: makeTab({ content: large, originalContent: large, contentVersion: 1 }),
    });
    const next = makeProps({
      isActive: false,
      tab: makeTab({ content: large, originalContent: large, contentVersion: 2 }),
      onTabContentChange: prev.onTabContentChange,
      onCloseTab: prev.onCloseTab,
      onReloadTab: prev.onReloadTab,
      onMdPreviewRequestedChange: prev.onMdPreviewRequestedChange,
    });
    expect(repositoryFileEditorTabSurfacePropsEqual(prev, next)).toBe(false);
  });

  test("活跃 tab 仍比较 content 引用", () => {
    const prev = makeProps({
      isActive: true,
      tab: makeTab({ content: "a", originalContent: "a" }),
    });
    const next = makeProps({
      isActive: true,
      tab: makeTab({ content: "b", originalContent: "a" }),
      onTabContentChange: prev.onTabContentChange,
      onCloseTab: prev.onCloseTab,
      onReloadTab: prev.onReloadTab,
      onMdPreviewRequestedChange: prev.onMdPreviewRequestedChange,
    });
    expect(repositoryFileEditorTabSurfacePropsEqual(prev, next)).toBe(false);
  });
});
