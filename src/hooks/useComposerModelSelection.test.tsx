import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";

mock.module("../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  setAppSetting: mock(async () => undefined),
}));

import { useComposerModelSelection } from "./useComposerModelSelection";
import {
  resetExecutionEngineModelDefaultsForTests,
  saveExecutionEngineDefaultModel,
} from "../services/executionEngineModelDefaults";

const keys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"] as const;
let descriptors: Array<PropertyDescriptor | undefined>;
let root: Root;
let container: HTMLElement;
let dom: Window;
let observed: string[];

function Child({ model }: { model: string }) {
  observed.push(model);
  return <span>{model}</span>;
}

function Composer({ id, engine, sessionModel }: {
  id: string; engine: SessionExecutionEngine; sessionModel: string;
}) {
  const [model] = useComposerModelSelection(id, engine, sessionModel);
  return <Child model={model} />;
}

beforeEach(() => {
  descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  dom = new Window();
  for (const [key, value] of [["window", dom], ["document", dom.document], ["IS_REACT_ACT_ENVIRONMENT", true]]) {
    Object.defineProperty(globalThis, key as string, { configurable: true, value });
  }
  container = document.createElement("div");
  root = createRoot(container);
  observed = [];
  resetExecutionEngineModelDefaultsForTests();
});

afterEach(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
  keys.forEach((key, index) => {
    const descriptor = descriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

describe("Composer model scope", () => {
  test("switching engines never renders the previous GPT model in the new menu", async () => {
    await act(async () => root.render(<Composer id="tab" engine="codex-rpc" sessionModel="gpt-old" />));
    observed = [];
    await act(async () => root.render(<Composer id="tab" engine="cursor" sessionModel="auto" />));
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((model) => model === "auto")).toBe(true);
  });

  test("empty target session restores only that engine's saved default", async () => {
    await saveExecutionEngineDefaultModel("cursor", "grok-selected");
    await saveExecutionEngineDefaultModel("codex-rpc", "gpt-selected");
    await act(async () => root.render(<Composer id="tab" engine="cursor" sessionModel="grok-selected" />));
    observed = [];
    await act(async () => root.render(<Composer id="tab" engine="codex-rpc" sessionModel="" />));
    expect(observed.every((model) => model === "gpt-selected")).toBe(true);
  });

  test("switching tabs resets a specific model to the target tab's Auto", async () => {
    await act(async () => root.render(<Composer id="first" engine="cursor" sessionModel="gpt-old" />));
    observed = [];
    await act(async () => root.render(<Composer id="second" engine="cursor" sessionModel="auto" />));
    expect(observed.every((model) => model === "auto")).toBe(true);
    expect(container.textContent).toBe("auto");
  });
});
