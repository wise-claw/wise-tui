import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { useLayoutEffect } from "react";
import {
  authorView,
  cockpitView,
  inspectView,
  mcpHubInspectTool,
  skillsHubInspectTool,
  useViewMode,
  type UseViewModeApi,
} from "./useViewMode";

/**
 * Bridge component that exposes a hook's return value to the test scope by
 * stashing it through a callback. Mirrors `useMissionPresenter.test.tsx`
 * conventions used elsewhere in the repo.
 */
function ProbeViewMode({ onValue }: { onValue: (api: UseViewModeApi) => void }) {
  const api = useViewMode();
  useLayoutEffect(() => {
    onValue(api);
  });
  return null;
}

function renderProbe() {
  let latest: UseViewModeApi | null = null;
  const onValue = (api: UseViewModeApi) => {
    latest = api;
  };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<ProbeViewMode onValue={onValue} />);
  });
  if (!latest) {
    throw new Error("ProbeViewMode never received a value");
  }
  return {
    get api() {
      if (!latest) throw new Error("api not ready");
      return latest;
    },
    unmount: () => renderer.unmount(),
  };
}

describe("useViewMode", () => {
  test("default view is chat because the main conversation has priority", () => {
    const probe = renderProbe();
    expect(probe.api.view).toEqual({ kind: "chat" });
    expect(probe.api.isChat).toBe(true);
    expect(probe.api.legacy.missionControlMode).toBe(false);
    probe.unmount();
  });

  test("enter cockpit then back returns to chat", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(cockpitView("m1"));
    });
    expect(probe.api.view).toEqual({ kind: "cockpit", missionId: "m1" });
    expect(probe.api.isCockpit).toBe(true);
    expect(probe.api.legacy.missionControlMode).toBe(true);

    act(() => {
      probe.api.back();
    });
    expect(probe.api.view).toEqual({ kind: "chat" });
    probe.unmount();
  });

  test("legacy flags are mutually exclusive across all view kinds", () => {
    const probe = renderProbe();
    const allModes = [
      cockpitView(),
      authorView("mcp"),
      authorView("skills"),
      inspectView(mcpHubInspectTool()),
      inspectView(skillsHubInspectTool()),
    ];
    for (const mode of allModes) {
      act(() => {
        probe.api.enter(mode);
      });
      const trueCount = Object.values(probe.api.legacy).filter(Boolean).length;
      expect(trueCount).toBe(1);
    }
    probe.unmount();
  });

  test("author panes that are not mcp/skills do not raise any legacy flag", () => {
    const probe = renderProbe();
    for (const pane of ["agents", "workflows", "hooks", "assistants"] as const) {
      act(() => {
        probe.api.enter(authorView(pane));
      });
      expect(probe.api.isAuthor).toBe(true);
      expect(probe.api.view).toEqual({ kind: "author", pane });
      const trueCount = Object.values(probe.api.legacy).filter(Boolean).length;
      expect(trueCount).toBe(0);
    }
    probe.unmount();
  });

  test("switching author panes does not stack history; back exits author once", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(cockpitView("m1"));
    });
    act(() => {
      probe.api.enter(authorView("agents"));
    });
    act(() => {
      probe.api.enter(authorView("assistants"));
    });
    expect(probe.api.view).toEqual({ kind: "author", pane: "assistants" });

    act(() => {
      probe.api.back();
    });
    expect(probe.api.view).toEqual({ kind: "cockpit", missionId: "m1" });
    probe.unmount();
  });

  test("entering author overrides previous pane", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(authorView("skills"));
    });
    expect(probe.api.legacy.skillsHubMode).toBe(true);
    act(() => {
      probe.api.enter(authorView("mcp"));
    });
    expect(probe.api.legacy.skillsHubMode).toBe(false);
    expect(probe.api.legacy.mcpHubMode).toBe(true);
    probe.unmount();
  });

  test("patch only merges within the same kind", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(cockpitView());
    });
    act(() => {
      probe.api.patch({ kind: "cockpit", missionId: "foo" });
    });
    expect(probe.api.view).toEqual({ kind: "cockpit", missionId: "foo" });

    // Switch to chat; patching cockpit should have no effect
    act(() => {
      probe.api.enter({ kind: "chat" });
    });
    act(() => {
      probe.api.patch({ kind: "cockpit", missionId: "bar" });
    });
    expect(probe.api.view).toEqual({ kind: "chat" });

    // Back to cockpit; patch merges again
    act(() => {
      probe.api.enter(cockpitView());
    });
    act(() => {
      probe.api.patch({ kind: "cockpit", missionId: "m42" });
    });
    expect(probe.api.view).toEqual({ kind: "cockpit", missionId: "m42" });
    probe.unmount();
  });

  test("switching cockpit hub panes does not stack history", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(cockpitView(undefined, "assistant"));
    });
    act(() => {
      probe.api.enter(cockpitView(undefined, "mcp"));
    });
    expect(probe.api.view).toEqual({ kind: "cockpit", hubPane: "mcp" });

    act(() => {
      probe.api.back();
    });
    expect(probe.api.view).toEqual({ kind: "chat" });
    probe.unmount();
  });

  test("sidebar MCP/skills overlay uses inspect and back returns to chat", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(inspectView(mcpHubInspectTool()));
    });
    expect(probe.api.view).toEqual({ kind: "inspect", tool: { kind: "mcp-hub" } });
    expect(probe.api.legacy.mcpHubMode).toBe(true);
    expect(probe.api.isChat).toBe(false);
    expect(probe.api.isInspect).toBe(true);

    act(() => {
      probe.api.enter(inspectView(skillsHubInspectTool()));
    });
    expect(probe.api.view).toEqual({ kind: "inspect", tool: { kind: "skills-hub" } });
    expect(probe.api.legacy.skillsHubMode).toBe(true);

    act(() => {
      probe.api.back();
    });
    expect(probe.api.view).toEqual({ kind: "chat" });
    probe.unmount();
  });

  test("switching MCP and skills inspect overlays does not stack history", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(inspectView(mcpHubInspectTool()));
    });
    act(() => {
      probe.api.enter(inspectView(skillsHubInspectTool()));
    });
    expect(probe.api.view).toEqual({ kind: "inspect", tool: { kind: "skills-hub" } });

    act(() => {
      probe.api.back();
    });
    expect(probe.api.view).toEqual({ kind: "chat" });
    probe.unmount();
  });

  test("entering one mode clears any other previously-active legacy flag", () => {
    const probe = renderProbe();
    act(() => {
      probe.api.enter(inspectView(mcpHubInspectTool()));
    });
    expect(probe.api.legacy.mcpHubMode).toBe(true);

    act(() => {
      probe.api.enter(cockpitView());
    });
    expect(probe.api.legacy.mcpHubMode).toBe(false);
    expect(probe.api.legacy.missionControlMode).toBe(true);
    probe.unmount();
  });
});
