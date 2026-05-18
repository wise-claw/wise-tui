import { describe, expect, mock, test } from "bun:test";
import { create, act } from "react-test-renderer";
import type { ComponentProps } from "react";
import type { ViewMode } from "../../types/viewMode";

// Mock the two dispatch targets so this file only validates Inspector's routing.
// Both children are tested in their own files (or downstream e2e):
//   - ChatInspector pulls in xterm/monaco/Tauri-bound services that don't load under bun:test.
//   - CockpitInspector instantiates antd Layout.Sider which throws in this env.
// We deliberately do NOT mock antd here — that would persist across the run and
// break tests in other files (`mock.module` is shared by file order).
mock.module("./ChatInspector", () => ({
  ChatInspector: () => <section data-testid="chat-inspector" />,
}));
mock.module("./CockpitInspector", () => ({
  CockpitInspector: (props: { activeProject: unknown; activeRepository: unknown }) => (
    <section
      data-testid="cockpit-inspector"
      data-has-project={props.activeProject ? "1" : "0"}
      data-has-repository={props.activeRepository ? "1" : "0"}
    />
  ),
}));

const { Inspector } = await import("./Inspector");

const baseChatInspectorProps = {} as ComponentProps<typeof Inspector>["chatInspectorProps"];
const baseCockpitInspectorProps = {
  dark: false,
  collapsed: false,
  activeProject: null,
  activeRepository: null,
  employeeMonitorItems: [],
} satisfies ComponentProps<typeof Inspector>["cockpitInspectorProps"];

function findByTestId(tree: ReturnType<typeof create>, testId: string) {
  return tree.root.findAll((node) => node.props && node.props["data-testid"] === testId);
}

/** Inspector 自身只是路由组件；这些用例只验证它按 ViewMode.kind 选了正确的子组件。 */
describe("Inspector", () => {
  test("chat mode renders the ChatInspector", () => {
    const view: ViewMode = { kind: "chat" };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Inspector
          viewMode={view}
          chatInspectorProps={baseChatInspectorProps}
          cockpitInspectorProps={baseCockpitInspectorProps}
        />,
      );
    });
    expect(findByTestId(tree, "chat-inspector")).toHaveLength(1);
    expect(findByTestId(tree, "cockpit-inspector")).toHaveLength(0);
    act(() => tree.unmount());
  });

  test("cockpit mode renders CockpitInspector", () => {
    const view: ViewMode = { kind: "cockpit" };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Inspector
          viewMode={view}
          chatInspectorProps={baseChatInspectorProps}
          cockpitInspectorProps={baseCockpitInspectorProps}
        />,
      );
    });
    expect(findByTestId(tree, "chat-inspector")).toHaveLength(0);
    expect(findByTestId(tree, "cockpit-inspector")).toHaveLength(1);
    act(() => tree.unmount());
  });

  test("cockpit mode forwards activeRepository to CockpitInspector", () => {
    const view: ViewMode = { kind: "cockpit" };
    const cockpitProps: ComponentProps<typeof Inspector>["cockpitInspectorProps"] = {
      ...baseCockpitInspectorProps,
      activeRepository: {
        id: 7,
        name: "demo",
        path: "/tmp/demo",
        repositoryType: "frontend",
        createdAt: "2026-05-17",
        updatedAt: "2026-05-17",
      },
    };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Inspector
          viewMode={view}
          chatInspectorProps={baseChatInspectorProps}
          cockpitInspectorProps={cockpitProps}
        />,
      );
    });
    const ci = findByTestId(tree, "cockpit-inspector");
    expect(ci).toHaveLength(1);
    expect(ci[0]?.props["data-has-repository"]).toBe("1");
    act(() => tree.unmount());
  });

  test("author mode renders nothing", () => {
    const view: ViewMode = { kind: "author", pane: "prompts" };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Inspector
          viewMode={view}
          chatInspectorProps={baseChatInspectorProps}
          cockpitInspectorProps={baseCockpitInspectorProps}
        />,
      );
    });
    expect(findByTestId(tree, "chat-inspector")).toHaveLength(0);
    expect(findByTestId(tree, "cockpit-inspector")).toHaveLength(0);
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  test("inspect mode falls back to ChatInspector", () => {
    const view: ViewMode = {
      kind: "inspect",
      tool: {
        kind: "code-graph",
        suppressIdleAutoReindex: false,
        lockToEntryRepository: false,
        defaultProjectMultiRepo: false,
      },
    };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Inspector
          viewMode={view}
          chatInspectorProps={baseChatInspectorProps}
          cockpitInspectorProps={baseCockpitInspectorProps}
        />,
      );
    });
    expect(findByTestId(tree, "chat-inspector")).toHaveLength(1);
    expect(findByTestId(tree, "cockpit-inspector")).toHaveLength(0);
    act(() => tree.unmount());
  });
});
