import { describe, expect, test, beforeEach } from "bun:test";
import {
  clampTerminalCenterPanelHost,
  closeTerminalCenterPanel,
  collapseTerminalCenterPanel,
  collapseTerminalCenterPanelOnPane,
  getTerminalCenterPanelState,
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
    expect(getTerminalCenterPanelState()).toEqual({
      mounted: true,
      collapsed: false,
      hostPaneIndex: 2,
      visible: true,
    });
  });

  test("toggle on same pane collapses; toggle on other pane moves host", () => {
    toggleTerminalCenterPanel(1);
    expect(getTerminalCenterPanelState().hostPaneIndex).toBe(1);
    expect(getTerminalCenterPanelState().visible).toBe(true);

    toggleTerminalCenterPanel(1);
    expect(getTerminalCenterPanelState().visible).toBe(false);
    expect(getTerminalCenterPanelState().mounted).toBe(true);

    toggleTerminalCenterPanel(0);
    expect(getTerminalCenterPanelState()).toMatchObject({
      visible: true,
      hostPaneIndex: 0,
    });
  });

  test("collapseTerminalCenterPanelOnPane only affects matching host", () => {
    openTerminalCenterPanel(1);
    collapseTerminalCenterPanelOnPane(0);
    expect(getTerminalCenterPanelState().visible).toBe(true);
    collapseTerminalCenterPanelOnPane(1);
    expect(getTerminalCenterPanelState().visible).toBe(false);
  });

  test("open on pane 0 closes memo; open memo collapses pane-0 terminal only", () => {
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);

    openTerminalCenterPanel(0);
    expect(getWorkspaceMemoPanelOpen()).toBe(false);
    expect(getTerminalCenterPanelState().visible).toBe(true);

    openTerminalCenterPanel(1);
    openWorkspaceMemoPanel();
    expect(getWorkspaceMemoPanelOpen()).toBe(true);
    expect(getTerminalCenterPanelState()).toMatchObject({
      visible: true,
      hostPaneIndex: 1,
    });
  });

  test("clampTerminalCenterPanelHost pulls host back into range", () => {
    openTerminalCenterPanel(3);
    clampTerminalCenterPanelHost(2);
    expect(getTerminalCenterPanelState().hostPaneIndex).toBe(0);
  });

  test("collapse keeps mounted but hides", () => {
    openTerminalCenterPanel(0);
    collapseTerminalCenterPanel();
    expect(getTerminalCenterPanelState()).toEqual({
      mounted: true,
      collapsed: true,
      hostPaneIndex: 0,
      visible: false,
    });
  });
});
