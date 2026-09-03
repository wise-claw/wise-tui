import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  hasLeftSidebarSectionDragPayload,
  isInteractiveLeftSidebarSectionDragTarget,
  LEFT_SIDEBAR_SECTION_DND_MIME,
  queryLeftSidebarSectionDragHandles,
  sameDragHandleSet,
} from "./leftSidebarSectionDrag";

describe("leftSidebarSectionDrag", () => {
  test("按钮和 ant-btn 不算分区拖拽起点", () => {
    const window = new Window();
    const doc = window.document;
    const header = doc.createElement("div");
    header.className = "git-panel-header";
    const button = doc.createElement("button");
    button.className = "ant-btn git-commit-btn";
    header.appendChild(button);
    expect(isInteractiveLeftSidebarSectionDragTarget(button)).toBe(true);
    expect(isInteractiveLeftSidebarSectionDragTarget(header)).toBe(false);
  });

  test("运行面板头部操作区不算分区拖拽起点", () => {
    const window = new Window();
    const doc = window.document;
    const actions = doc.createElement("div");
    actions.className = "app-monitor-panel__head-actions";
    const icon = doc.createElement("span");
    actions.appendChild(icon);
    expect(isInteractiveLeftSidebarSectionDragTarget(icon)).toBe(true);
  });

  test("标题空白处可以开始拖拽", () => {
    const window = new Window();
    const title = window.document.createElement("div");
    title.className = "app-monitor-panel__title";
    title.textContent = "运行面板";
    expect(isInteractiveLeftSidebarSectionDragTarget(title)).toBe(false);
  });

  test("识别分区拖拽 MIME", () => {
    expect(hasLeftSidebarSectionDragPayload(null)).toBe(false);
    expect(
      hasLeftSidebarSectionDragPayload({
        types: [LEFT_SIDEBAR_SECTION_DND_MIME],
      } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      hasLeftSidebarSectionDragPayload({
        types: ["text/plain"],
      } as unknown as DataTransfer),
    ).toBe(false);
  });

  test("query 只命中分区标题栏，不把 Git 文件列表当拖拽柄", () => {
    const window = new Window();
    const doc = window.document;
    const root = doc.createElement("div");
    const tabs = doc.createElement("div");
    tabs.className = "app-left-sidebar-bottom-tabs";
    const header = doc.createElement("div");
    header.className = "git-panel-header";
    const file = doc.createElement("div");
    file.className = "git-file-row";
    tabs.append(header, file);
    root.appendChild(tabs);
    const handles = queryLeftSidebarSectionDragHandles(root);
    expect(handles).toEqual([header as unknown as HTMLElement]);
  });

  test("sameDragHandleSet 按节点引用比较", () => {
    const window = new Window();
    const a = window.document.createElement("div") as unknown as HTMLElement;
    const b = window.document.createElement("div") as unknown as HTMLElement;
    expect(sameDragHandleSet([a], [a])).toBe(true);
    expect(sameDragHandleSet([a], [b])).toBe(false);
    expect(sameDragHandleSet([a], [a, b])).toBe(false);
  });
});
