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
  consumeWorkspaceTerminalsClosing,
  resetTerminalWorkspaceTabsStoreForTests,
} from "./terminalWorkspaceTabsStore";
import {
  closeWorkspaceMemoPanel,
  getWorkspaceMemoPanelOpen,
  openWorkspaceMemoPanel,
} from "./workspaceMemoPanelStore";

describe("terminalCenterPanelStore", () => {
  beforeEach(() => {
    closeTerminalCenterPanel();
    closeWorkspaceMemoPanel();
    resetTerminalWorkspaceTabsStoreForTests();
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

  test("toggle on same pane unmounts; other pane stays independent", () => {
    toggleTerminalCenterPanel(1);
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);

    toggleTerminalCenterPanel(1);
    // ⌃` 关闭是卸挂载，不是 collapse 保活
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(false);
    expect(getTerminalCenterPanelState().mountedPaneIndexes).not.toContain(1);

    toggleTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    expect(getTerminalCenterPanelState().visiblePaneIndexes).toEqual([0]);
  });

  test("toggle while terminal visible but centerView is messages unmounts terminal", () => {
    openTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    syncPaneCenterView(0, "messages");
    toggleTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(getTerminalCenterPanelState().mounted).toBe(false);
    // 未强制改 centerView；UI 靠 hasTerminal=false 让 Segmented 去掉「终端」
    expect(getPaneCenterView(0)).toBe("messages");
  });

  test("toggle while on terminal unmounts so Segmented loses 终端 tab", () => {
    openTerminalCenterPanel(0);
    expect(getPaneCenterView(0)).toBe("terminal");
    toggleTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(getTerminalCenterPanelState().mounted).toBe(false);
    // 不在 store 里强制切 messages（那会留下「消息|终端」像切 tab）；
    // centerView 仍可为 terminal，由 useCenterView 在 hasTerminal=false 时 fallback
    expect(getPaneCenterView(0)).toBe("terminal");
  });

  test("toggle while terminal visible but centerView is files unmounts without yanking to messages", () => {
    openTerminalCenterPanel(0);
    syncPaneCenterView(0, "files");
    toggleTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(getTerminalCenterPanelState().mounted).toBe(false);
    expect(getPaneCenterView(0)).toBe("files");
  });

  test("collapseTerminalCenterPanelOnPane leaves terminal centerView", () => {
    openTerminalCenterPanel(0);
    syncPaneCenterView(0, "terminal");
    collapseTerminalCenterPanelOnPane(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(getPaneCenterView(0)).toBe("messages");
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

  test("open on pane 0 closes memo; open memo does not collapse terminal (independent slots)", () => {
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);

    openTerminalCenterPanel(0);
    expect(getWorkspaceMemoPanelOpen()).toBe(false);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);

    openTerminalCenterPanel(1);
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);
    // 备忘录与终端独立 slot，打开备忘录不再收起任一屏终端
    expect(isTerminalCenterPanelVisibleOnPane(1)).toBe(true);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
  });

  test("re-openTerminal after collapse restores visibility for centerView switch", () => {
    openTerminalCenterPanel(0);
    collapseTerminalCenterPanelOnPane(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(false);
    expect(getTerminalCenterPanelState().mountedPaneIndexes).toEqual([0]);

    // Segmented 切回「终端」走 openTerminalCenterPanel：应恢复可见并请求 terminal 视图
    openTerminalCenterPanel(0);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
    expect(getPaneCenterView(0)).toBe("terminal");
  });

  test("clampTerminalCenterPanelHost drops out-of-range panes", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(3);
    clampTerminalCenterPanelHost(2);
    expect(isTerminalCenterPanelVisibleOnPane(3)).toBe(false);
    expect(isTerminalCenterPanelVisibleOnPane(0)).toBe(true);
  });

  // 卸载本身不再代表用户要关终端：只有被标记为「显式关闭」的屏才允许在卸载时结束 PTY，
  // 否则 1 屏 ↔ 多屏切换会杀掉第一屏正在跑的终端。
  test("explicit close marks the pane so unmount ends its PTY", () => {
    openTerminalCenterPanel(0);
    closeTerminalCenterPanelOnPane(0);
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(true);
  });

  test("toggle-off marks the pane as explicitly closed", () => {
    toggleTerminalCenterPanel(1);
    toggleTerminalCenterPanel(1);
    expect(consumeWorkspaceTerminalsClosing("pane-1")).toBe(true);
  });

  test("collapse never marks the pane, so the PTY stays alive", () => {
    openTerminalCenterPanel(0);
    collapseTerminalCenterPanelOnPane(0);
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);

    openTerminalCenterPanel(0);
    collapseTerminalCenterPanel();
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("opening a pane clears a stale closing mark", () => {
    openTerminalCenterPanel(0);
    closeTerminalCenterPanelOnPane(0);
    openTerminalCenterPanel(0);
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("clamp marks dropped panes but leaves surviving ones alive", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(3);
    clampTerminalCenterPanelHost(2);
    expect(consumeWorkspaceTerminalsClosing("pane-3")).toBe(true);
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("closing every pane marks each mounted pane", () => {
    openTerminalCenterPanel(0);
    openTerminalCenterPanel(1);
    closeTerminalCenterPanel();
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(true);
    expect(consumeWorkspaceTerminalsClosing("pane-1")).toBe(true);
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
