import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useAppSidebarSelection } from "./useAppSidebarSelection";
import type { ClaudeSession, Repository, ProjectItem } from "../types";
import { getActivePaneIndex, markPaneActive, resetActivePaneIndex } from "../stores/activePaneIndexStore";
import { getPaneCenterView, registerPaneCenterViewSetter, syncPaneCenterView } from "../stores/paneCenterViewControlStore";
import { projectMainSessionBindingKey } from "../utils/repositoryMainSessionBinding";

const dom = new Window({ url: "https://wise.local" });
globalThis.window = dom as unknown as Window & typeof globalThis.window;
let renderer: ReactTestRenderer | undefined;
type Options = Parameters<typeof useAppSidebarSelection>[0];

const repositories: Repository[] = [1, 2].map(id => ({
  id, name: `repo-${id}`, path: `/repo-${id}`, repositoryType: "frontend", createdAt: "2026-10-06",
}));
const project: ProjectItem = {
  id: "project", name: "项目", repositoryIds: [2], rootPath: "/project", createdAt: 1, updatedAt: 1,
};
const sessions: ClaudeSession[] = ["/repo-1", "/repo-2", "/project"].map((path, i) => ({
  id: `session-${i}`, claudeSessionId: null, repositoryPath: path, repositoryName: path.slice(1),
  model: "", status: "idle", messages: [], createdAt: i + 1, pendingPrompt: "",
}));

function mount(overrides: Partial<Options> = {}) {
  const switchSession = mock((_id: string) => {});
  const jump = mock((_id: string) => {});
  const setRepository = mock((_id: number | null) => {});
  const setOwner = mock((_id: number) => {});
  const setProject = mock((_id: string) => {});
  const selectExtra = mock((_slot: number, _id: number) => {});
  const bindings = { [projectMainSessionBindingKey(project.id)]: "session-2" };
  const options: Options = {
    repositories, projects: [project], activeProjectId: null, activeRepositoryId: 1,
    activeWorkspaceFocus: "repository", repositoryListLoading: true, tabsHydrated: false,
    sessionsStructureKey: "fixture", repositoryMainSessionBindings: bindings,
    sessionsLatestRef: { current: sessions }, repositoryMainBindingsLatestRef: { current: bindings },
    repositoriesLatestRef: { current: repositories }, activeSessionIdLatestRef: { current: "session-0" },
    releaseSessionHostProcessRef: { current: async () => {} },
    bindRepositoryMainSession: async () => {}, bindRepositoryMainSessionRef: { current: async () => {} },
    jumpToSessionWithRepository: jump, jumpToSessionWithRepositoryRef: { current: jump },
    createSession: mock(async () => { throw new Error("Selection should reuse existing sessions"); }),
    switchSession, cancelSession: () => {}, reloadFullDiskTranscript: async () => {},
    setActiveRepositoryId: setRepository, setActiveProjectId: setProject, setActiveRepositoryWithOwner: setOwner,
    viewMode: { view: { kind: "chat" }, isChat: true, isAuthor: false, isInspect: false, isCockpit: false,
      enter: mock(() => {}), back: mock(() => {}), patch: () => {},
      legacy: { mcpHubMode: false, skillsHubMode: false, missionControlMode: false } },
    paneCountRef: { current: 4 },
    extraPanes: [{ slotId: "extra-1", repositoryId: 1, sessionId: "session-0" },
      { slotId: "extra-2", repositoryId: 2, sessionId: "session-1" },
      { slotId: "extra-3", repositoryId: 1, sessionId: "session-0" }],
    handlePaneRepositorySelect: selectExtra, suppressProjectSelectToChatRef: { current: false },
    ...overrides,
  };
  const extraBefore = structuredClone(options.extraPanes);
  let api!: ReturnType<typeof useAppSidebarSelection>;
  function Probe() { api = useAppSidebarSelection(options); return null; }
  act(() => { renderer = create(<Probe />); });
  return { api, options, extraBefore, switchSession, jump, setRepository, setOwner, setProject, selectExtra };
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetActivePaneIndex();
  for (let index = 0; index < 4; index++) registerPaneCenterViewSetter(index, null);
});

function focusExtra() {
  markPaneActive(2);
  syncPaneCenterView(0, "files");
  syncPaneCenterView(2, "terminal");
}
function expectPrimarySelection(probe: ReturnType<typeof mount>) {
  expect(getActivePaneIndex()).toBe(0);
  expect(getPaneCenterView(0)).toBe("messages");
  expect(getPaneCenterView(2)).toBe("terminal");
  expect(probe.selectExtra).not.toHaveBeenCalled();
  expect(probe.options.extraPanes).toEqual(probe.extraBefore);
}

describe("sidebar workspace selection", () => {
  test("repository click switches the primary session even after focusing an extra pane", () => {
    const probe = mount();
    focusExtra();
    act(() => probe.api.handleSidebarRepositorySelectLeavingMcpHub(2));
    expect(probe.setOwner).toHaveBeenCalledWith(2);
    expect(probe.switchSession).toHaveBeenCalledWith("session-1");
    expectPrimarySelection(probe);
  });

  test("project click switches the primary session without rebinding another pane", () => {
    const probe = mount();
    focusExtra();
    act(() => probe.api.handleProjectSelectLeavingMcpHub(project.id));
    expect(probe.setProject).toHaveBeenCalledWith(project.id);
    expect(probe.switchSession).toHaveBeenCalledWith("session-2");
    expectPrimarySelection(probe);
  });

  test("clicking the selected project still reveals messages in the first pane", () => {
    const probe = mount({ activeProjectId: project.id, activeWorkspaceFocus: "project" });
    focusExtra();
    act(() => probe.api.handleProjectSelectLeavingMcpHub(project.id));
    expect(probe.switchSession).not.toHaveBeenCalled();
    expectPrimarySelection(probe);
  });

  test("session click targets the first pane and reveals its messages", () => {
    const probe = mount();
    focusExtra();
    act(() => probe.api.jumpToSessionLeavingMcpHub("session-1"));
    expect(probe.jump).toHaveBeenCalledWith("session-1");
    expectPrimarySelection(probe);
  });

  test("a pane's repository picker still changes its own pane", () => {
    const probe = mount();
    focusExtra();
    act(() => probe.api.handlePickedActiveRepositoryForCurrentPane(1));
    expect(probe.selectExtra).toHaveBeenCalledWith(1, 1);
    expect(probe.setRepository).not.toHaveBeenCalled();
    expect(getActivePaneIndex()).toBe(2);
  });

  test("the primary repository picker works when multiple panes are open", () => {
    const probe = mount();
    markPaneActive(0);
    act(() => probe.api.handlePickedActiveRepositoryForCurrentPane(2));
    expect(probe.setRepository).toHaveBeenCalledWith(2);
    expect(probe.selectExtra).not.toHaveBeenCalled();
  });
});
