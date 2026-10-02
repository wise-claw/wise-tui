import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeSession } from "../types";
import { publishClaudeSessions } from "../stores/claudeSessionsLiveStore";
import {
  monitorSessionsTerminalStatusFingerprint,
  useMonitorSessionsFingerprint,
  useMonitorSessionsForOverview,
  useMonitorSidebarFingerprints,
} from "./useMonitorSessionsForOverview";

const globalKeys = [
  "window", "document", "Element", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT",
] as const;
let savedGlobals: Record<string, unknown>;
let root: Root;
let container: HTMLElement;
let domWindow: Window;
let frames: Map<number, FrameRequestCallback>;

function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(performance.now());
}

function session(status: ClaudeSession["status"]): ClaudeSession {
  return {
    id: "status-tab",
    claudeSessionId: "status-session",
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "",
    status,
    createdAt: 1,
    pendingPrompt: "",
    messages: [{ id: "answer", role: "assistant", content: "answer", timestamp: 1 }],
  };
}

beforeEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  savedGlobals = Object.fromEntries(globalKeys.map((key) => [key, globals[key]]));
  domWindow = new Window({ url: "http://localhost/" });
  for (const key of globalKeys) {
    globals[key] = key === "IS_REACT_ACT_ENVIRONMENT"
      ? true
      : (domWindow as unknown as Record<string, unknown>)[key];
  }
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  while (frames.size > 0) flushFrame();
  publishClaudeSessions([]);
  domWindow.happyDOM.abort();
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of globalKeys) globals[key] = savedGlobals[key];
});

describe("monitor execution status delivery", () => {
  for (const enabled of [false, true]) {
    test(`delivers lifecycle changes in the store notification frame (polling ${enabled})`, () => {
      const source = { current: [session("completed")] };
      let rendered: ClaudeSession[] = [];
      function Probe() {
        rendered = useMonitorSessionsForOverview(source, enabled);
        return <span>{rendered[0]?.status}</span>;
      }
      publishClaudeSessions(source.current);
      act(() => { root.render(<Probe />); });

      for (const status of ["connecting", "running", "idle", "running", "error", "running", "cancelled"] as const) {
        source.current = [session(status)];
        act(() => {
          publishClaudeSessions(source.current);
          flushFrame();
        });
        expect(container.textContent).toBe(status);
        expect(frames.size).toBe(0);
      }

      source.current = [session("running")];
      act(() => { publishClaudeSessions(source.current); flushFrame(); });
      const before = rendered;
      source.current = [{
        ...source.current[0]!,
        messages: [{ ...source.current[0]!.messages[0]!, content: "streaming text grows" }],
      }];
      act(() => { publishClaudeSessions(source.current); flushFrame(); });
      expect(rendered).toBe(before);
    });
  }

  test("sidebar fingerprints follow status changes without waiting for polling", () => {
    let single = "";
    let sidebar = { monitorSessionsFingerprint: "", transcriptSessionsFingerprint: "" };
    function Probe({ monitor, transcript }: { monitor: ClaudeSession[]; transcript: ClaudeSession[] }) {
      single = useMonitorSessionsFingerprint(monitor);
      sidebar = useMonitorSidebarFingerprints(monitor, transcript);
      return null;
    }
    const completed = [session("completed")];
    act(() => { root.render(<Probe monitor={completed} transcript={completed} />); });
    const running = [session("running")];
    act(() => { root.render(<Probe monitor={running} transcript={completed} />); });
    expect(single).toBe(monitorSessionsTerminalStatusFingerprint(running));
    expect(sidebar.monitorSessionsFingerprint).toBe(single);
    expect(sidebar.transcriptSessionsFingerprint).toBe(monitorSessionsTerminalStatusFingerprint(completed));
    act(() => { root.render(<Probe monitor={completed} transcript={running} />); });
    expect(single).toBe(monitorSessionsTerminalStatusFingerprint(completed));
    expect(sidebar.monitorSessionsFingerprint).toBe(single);
    expect(sidebar.transcriptSessionsFingerprint).toBe(monitorSessionsTerminalStatusFingerprint(running));
  });
});
