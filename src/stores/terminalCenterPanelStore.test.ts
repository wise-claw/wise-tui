import { describe, expect, test, beforeEach } from "bun:test";
import {
  getPaneCenterView,
  syncPaneCenterView,
} from "./paneCenterViewControlStore";
import {
  clampTerminalCenterPanelHost,
  closeTerminalCenterPanel,
  closeTerminalCenterPanelOnPane,
  collapseTerminalCenterPanel,
  collapseTerminalCenterPanelOnPane,
  getTerminalCenterPanelState,
  isTerminalCenterPanelVisibleOnPane,
  openTerminalCenterPanel,
  toggleTerminalCenterPanel,
} from "./terminalCenterPanelStore";
import {
  closeWorkspaceMemoPanel,
  getWorkspaceMemoPanelOpen,
  openWorkspaceMemoPanel,
} from "./workspaceMemoPanelStore";

describe("terminalCenterPanelStore", () => {
  beforeEach(() => {
    closeTerminalCenterPanel();
    closeWorkspaceMemoPanel();
  });

  test("getSnapshot returns stable identity when unchanged", () => {
    const a = getTerminalCenterPanelState();
    const b = getTerminalCenterPanelState();
    expect(a).toBe(b);
  });

  test("open makes panel visible on target pane", () => {
    openTerminalCenterPanel(2);
    expect(isTerminalCenterPanelVisibleOnPane(2)).toBe(true);
    expect(getTerminalCenterPanelState()).toMatchObject({
      mounted: true,
      collapsed: false,
      hostPaneIndex: 2,
      visible: true,
      visiblePaneIndexes: [2],
    });
  });

  test("toggle on same pane collapses; other pane stays independent", () => {
    toggleTerminalCenterPanel(1);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);

    toggleTerminalCenterPanel(1);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(false);
    expect(getTerminalCenterPanelState().mounted).toBe(true);

    toggleTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    // 收起的屏 1 仍挂载，但不应被屏 0 打开清掉
    expect(getTerminalCenterPanelState().mountedPaneIndexes).toContain(1);
    expect(getTerminalCenterPanelState().visiblePaneIndexes).toEqual([0]);
  });

  test("toggle while terminal visible but centerView is messages focuses terminal instead of collapsing", () => {
    openTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    // 用户切到消息 tab
    syncPaneCenterView(0, "messages");
    toggleTerminalCenterPanel(0);
    // 仍可见，且视图请求切回 terminal（不收起）
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    expect(getPaneCenterView(0)).toBe("terminal");
  });

  test("opening second pane keeps first pane terminal open", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(1);
    expect(getTerminalCenterPanelState().visiblePaneIndexes).toEqual([0, 1]);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);
  });

  test("collapseTerminalCenterPanelOnPane only affects matching host", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(1);
    collapseTerminalCenterPanelOnPane(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);
  });

  test("closeTerminalCenterPanelOnPane only removes that pane", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(1);
    closeTerminalCenterPanelOnPane(1);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    expect(getTerminalCenterPanelState().mountedPaneIndexes).toEqual([0]);
  });

  test("open on pane 0 closes memo; open memo collapses pane-0 terminal only", () => {
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);

    openTerminalCenterPanel(0);
    expect(getWorkspaceMemoPanelOpen()).toBe(false);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);

    openTerminalCenterPanel(1);
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
  });

  test("clampTerminalCenterPanelHost drops out-of-range panes", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(3);
    clampTerminalCenterPanelHost(2);
    expect(isTerminalCenterPanelVisibleOnPane(3)).toBe(false);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
  });

  test("collapse keeps mounted but hides", () => {
    openTerminalCenterPanel(0);
    collapseTerminalCenterPanel();
    expect(getTerminalCenterPanelState()).toMatchObject({
      mounted: true,
      collapsed: true,
      visible: false,
      mountedPaneIndexes: [0],
      visiblePaneIndexes: [],
    });
  });
});
