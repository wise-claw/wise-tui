import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearWorkspaceTerminals,
  clearWorkspaceTerminalsClosing,
  closeWorkspaceTerminal,
  consumeWorkspaceTerminalsClosing,
  createWorkspaceTerminal,
  ensureWorkspaceTerminal,
  getTerminalWorkspaceTabs,
  getWorkspaceTerminalSource,
  listWorkspaceTerminalIds,
  markWorkspaceTerminalsClosing,
  registerWorkspaceTerminal,
  resetTerminalWorkspaceTabsStoreForTests,
  setWorkspaceActiveTerminal,
  subscribeTerminalWorkspaceTabs,
} from "./terminalWorkspaceTabsStore";

describe("terminalWorkspaceTabsStore", () => {
  beforeEach(() => {
    resetTerminalWorkspaceTabsStoreForTests();
  });

  test("getSnapshot returns stable identity when unchanged", () => {
    expect(getTerminalWorkspaceTabs("pane-0")).toBe(getTerminalWorkspaceTabs("pane-0"));
    createWorkspaceTerminal("pane-0");
    expect(getTerminalWorkspaceTabs("pane-0")).toBe(getTerminalWorkspaceTabs("pane-0"));
  });

  test("tab state survives host unmount so the pane can attach back", () => {
    const id = createWorkspaceTerminal("pane-0");
    // 模拟布局重建：宿主组件卸载再挂载，期间不碰 store。
    expect(ensureWorkspaceTerminal("pane-0")).toBe(id);
    expect(listWorkspaceTerminalIds("pane-0")).toEqual([id]);
  });

  test("panes keep independent buckets", () => {
    const first = createWorkspaceTerminal("pane-0");
    const second = createWorkspaceTerminal("pane-1");
    expect(first).not.toBe(second);
    expect(listWorkspaceTerminalIds("pane-0")).toEqual([first]);
    expect(listWorkspaceTerminalIds("pane-1")).toEqual([second]);

    clearWorkspaceTerminals("pane-1");
    expect(listWorkspaceTerminalIds("pane-0")).toEqual([first]);
    expect(listWorkspaceTerminalIds("pane-1")).toEqual([]);
  });

  test("ensure reuses the last tab when active id was dropped", () => {
    const first = createWorkspaceTerminal("pane-0");
    const second = createWorkspaceTerminal("pane-0");
    setWorkspaceActiveTerminal("pane-0", first);
    closeWorkspaceTerminal("pane-0", first);
    expect(getTerminalWorkspaceTabs("pane-0").activeTerminalId).toBe(second);
    expect(ensureWorkspaceTerminal("pane-0")).toBe(second);
  });

  test("ensure creates exactly one tab on an empty bucket", () => {
    const id = ensureWorkspaceTerminal("pane-0");
    expect(ensureWorkspaceTerminal("pane-0")).toBe(id);
    expect(listWorkspaceTerminalIds("pane-0")).toEqual([id]);
  });

  test("auto-named tabs renumber after a close", () => {
    createWorkspaceTerminal("pane-0");
    const second = createWorkspaceTerminal("pane-0");
    createWorkspaceTerminal("pane-0");
    expect(getTerminalWorkspaceTabs("pane-0").tabs.map((tab) => tab.title)).toEqual([
      "Terminal 1",
      "Terminal 2",
      "Terminal 3",
    ]);

    closeWorkspaceTerminal("pane-0", second);
    expect(getTerminalWorkspaceTabs("pane-0").tabs.map((tab) => tab.title)).toEqual([
      "Terminal 1",
      "Terminal 2",
    ]);
  });

  test("register keeps explicit titles and agent source, and ignores duplicates", () => {
    registerWorkspaceTerminal("pane-0", { id: "agent-1", source: "agent" });
    registerWorkspaceTerminal("pane-0", { id: "agent-1", source: "agent" });
    expect(getTerminalWorkspaceTabs("pane-0").tabs).toHaveLength(1);
    expect(getWorkspaceTerminalSource("pane-0", "agent-1")).toBe("agent");
    // 未带标题的会话仍归入自动编号，「Agent 终端」这个预设值会被 renumber 覆盖。
    expect(getTerminalWorkspaceTabs("pane-0").tabs[0]?.title).toBe("Terminal 1");

    registerWorkspaceTerminal("pane-0", { id: "named", title: "构建" });
    expect(getTerminalWorkspaceTabs("pane-0").tabs[1]?.title).toBe("构建");
  });

  test("register does not steal focus from the active tab", () => {
    const active = createWorkspaceTerminal("pane-0");
    registerWorkspaceTerminal("pane-0", { id: "agent-1", source: "agent" });
    expect(getTerminalWorkspaceTabs("pane-0").activeTerminalId).toBe(active);
  });

  test("closing flag is only consumable once, and per workspace", () => {
    markWorkspaceTerminalsClosing("pane-0");
    expect(consumeWorkspaceTerminalsClosing("pane-1")).toBe(false);
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(true);
    // 第二次卸载（例如布局重建）不得再被当成显式关闭。
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("unmount without a closing flag keeps the PTY alive", () => {
    createWorkspaceTerminal("pane-0");
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("clearing the closing flag protects a reopened terminal", () => {
    markWorkspaceTerminalsClosing("pane-0");
    clearWorkspaceTerminalsClosing("pane-0");
    expect(consumeWorkspaceTerminalsClosing("pane-0")).toBe(false);
  });

  test("subscribers are notified per workspace", () => {
    let paneZero = 0;
    let paneOne = 0;
    const unsubscribe = subscribeTerminalWorkspaceTabs("pane-0", () => {
      paneZero += 1;
    });
    subscribeTerminalWorkspaceTabs("pane-1", () => {
      paneOne += 1;
    });

    createWorkspaceTerminal("pane-0");
    expect(paneZero).toBe(1);
    expect(paneOne).toBe(0);

    unsubscribe();
    createWorkspaceTerminal("pane-0");
    expect(paneZero).toBe(1);
  });
});
