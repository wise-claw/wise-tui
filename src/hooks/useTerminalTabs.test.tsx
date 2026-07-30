import { beforeEach, describe, expect, test } from "bun:test";
import { useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import { resetTerminalWorkspaceTabsStoreForTests } from "../stores/terminalWorkspaceTabsStore";
import { useTerminalTabs } from "./useTerminalTabs";

type TabsApi = ReturnType<typeof useTerminalTabs>;

function mountProbe(workspaceId: string) {
  let latest: TabsApi | null = null;
  let renderCount = 0;

  function Probe() {
    const api = useTerminalTabs({ workspaceId });
    renderCount += 1;
    useLayoutEffect(() => {
      latest = api;
    });
    return null;
  }

  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(<Probe />);
  });
  if (!latest) throw new Error("Probe never received a value");

  return {
    get api(): TabsApi {
      if (!latest) throw new Error("Probe has no value");
      return latest;
    },
    get renderCount() {
      return renderCount;
    },
    unmount() {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

describe("useTerminalTabs", () => {
  beforeEach(() => {
    resetTerminalWorkspaceTabsStoreForTests();
  });

  // 这是「第一屏开了终端，再切到多屏后终端被干掉」的回归点：切屏会让宿主整棵卸载重建，
  // 重建后必须拿回同一个 terminalId，否则只能新开 PTY，用户的终端内容就丢了。
  test("remounting the same pane keeps the previous terminal id", () => {
    const first = mountProbe("pane-0");
    let terminalId = "";
    act(() => {
      terminalId = first.api.ensureTerminal();
    });
    expect(terminalId).not.toBe("");
    first.unmount();

    const second = mountProbe("pane-0");
    expect(second.api.activeTerminalId).toBe(terminalId);
    let reused = "";
    act(() => {
      reused = second.api.ensureTerminal();
    });
    expect(reused).toBe(terminalId);
    expect(second.api.terminals).toHaveLength(1);
  });

  test("a different pane gets its own terminal", () => {
    const paneZero = mountProbe("pane-0");
    let zeroId = "";
    act(() => {
      zeroId = paneZero.api.ensureTerminal();
    });

    const paneOne = mountProbe("pane-1");
    expect(paneOne.api.activeTerminalId).toBeNull();
    let oneId = "";
    act(() => {
      oneId = paneOne.api.ensureTerminal();
    });
    expect(oneId).not.toBe(zeroId);
    expect(paneZero.api.activeTerminalId).toBe(zeroId);
  });

  test("store updates reach a mounted subscriber", () => {
    const probe = mountProbe("pane-0");
    act(() => {
      probe.api.createTerminal();
    });
    expect(probe.api.terminals).toHaveLength(1);

    act(() => {
      probe.api.createTerminal();
    });
    expect(probe.api.terminals).toHaveLength(2);
  });

  test("terminals keep a stable identity across re-renders", () => {
    const probe = mountProbe("pane-0");
    act(() => {
      probe.api.ensureTerminal();
    });
    const before = probe.api.terminals;
    const rendersBefore = probe.renderCount;

    act(() => {
      probe.api.setActiveTerminal(before[0]!.id);
    });
    // 同一 active tab 再设一次不应改变快照，也不该触发额外渲染。
    expect(probe.api.terminals).toBe(before);
    expect(probe.renderCount).toBe(rendersBefore);
  });

  test("closing the last tab clears the active id", () => {
    const probe = mountProbe("pane-0");
    let id = "";
    act(() => {
      id = probe.api.ensureTerminal();
    });
    act(() => {
      probe.api.closeTerminal(id);
    });
    expect(probe.api.terminals).toHaveLength(0);
    expect(probe.api.activeTerminalId).toBeNull();
  });
});
