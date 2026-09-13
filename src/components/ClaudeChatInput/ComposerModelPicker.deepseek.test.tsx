import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeSession } from "../../types";

/** dsh --profile acp 真实目录形状：id 是 JSON 数组字符串，按 provider 分组。 */
const DEEPSEEK_FLASH = '["deepseek-official","deepseek-flash"]';
const DEEPSEEK_V4_PRO = '["deepseek-official","deepseek-v4-pro"]';
const DEEPSEEK_CATALOG = [
  { id: DEEPSEEK_FLASH, displayName: "DeepSeek-V41-Flash", providerId: "deepseek-official" },
  { id: DEEPSEEK_V4_PRO, displayName: "DeepSeek-V4-Pro", providerId: "deepseek-official" },
];

const invokeMock = mock(async (cmd: string) => {
  if (cmd === "deepseek_list_models") return DEEPSEEK_CATALOG;
  if (cmd === "get_claude_model_profile_store") return null;
  return null;
});

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => false,
}));

mock.module("../ClaudeSessions/ClaudeModelTopbarPanel", () => ({
  ClaudeModelTopbarPanel: () => null,
}));

import { ComposerModelPicker } from "./ComposerModelPicker";
import { useComposerModelSelection } from "../../hooks/useComposerModelSelection";
import { seedModelProfileStoreCache } from "../../stores/modelProfileStoreCache";
import { resetExecutionEngineModelListsForTests } from "../../services/executionEngineModelListCache";
import { resetExecutionEngineModelDefaultsForTests } from "../../services/executionEngineModelDefaults";
import { resolveEngineSwitchComposerModel } from "../../utils/newSessionComposerDefaults";

const GLOBAL_KEYS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT", "navigator"] as const;

let descriptors: Array<PropertyDescriptor | undefined>;
let dom: Window;
let root: Root;

function makeSession(model: string, engine: "deepseek" | "codex-rpc" = "deepseek"): ClaudeSession {
  return {
    id: "s1",
    claudeSessionId: "s1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    executionEngine: engine,
    model,
    status: "idle",
    messages: [],
    createdAt: 0,
    pendingPrompt: "",
  } as ClaudeSession;
}

function Host({ initialModel, engine }: { initialModel: string; engine: "deepseek" | "codex-rpc" }) {
  const [session, setSession] = useState<ClaudeSession>(() => makeSession(initialModel, engine));
  const [model, setModel] = useComposerModelSelection(session.id, engine, session.model);
  const onModelChange = useCallback(
    (next: string) => {
      setModel(next);
      setSession((prev) => (prev.model === next ? prev : { ...prev, model: next }));
    },
    [setModel],
  );
  return (
    <div>
      <span className="host-model">{model}</span>
      <ComposerModelPicker
        session={session}
        sessionExecutionEngine={engine}
        key={`${session.id}:${engine}`}
        model={model}
        onModelChange={onModelChange}
      />
    </div>
  );
}

/** 其他引擎 → DeepSeek：复刻会话宿主的引擎切换（模型按环境默认重算）。 */
function EngineSwitchHost() {
  const [engine, setEngine] = useState<"codex-rpc" | "deepseek">("codex-rpc");
  const [session, setSession] = useState<ClaudeSession>(() => makeSession("gpt-5.6-sol", "codex-rpc"));
  const [model, setModel] = useComposerModelSelection(session.id, engine, session.model);
  const onModelChange = useCallback(
    (next: string) => {
      setModel(next);
      setSession((prev) => (prev.model === next ? prev : { ...prev, model: next }));
    },
    [setModel],
  );
  return (
    <div>
      <span className="host-model">{model}</span>
      <button
        type="button"
        className="switch-engine"
        onClick={() => {
          const nextModel = resolveEngineSwitchComposerModel("deepseek", session.model, engine);
          setSession((prev) => ({ ...prev, executionEngine: "deepseek", model: nextModel }));
          setEngine("deepseek");
        }}
      >
        switch
      </button>
      <ComposerModelPicker
        session={session}
        sessionExecutionEngine={engine}
        key={`${session.id}:${engine}`}
        model={model}
        onModelChange={onModelChange}
      />
    </div>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostModel(): string {
  return dom.document.querySelector(".host-model")?.textContent?.trim() ?? "";
}

function triggerLabel(): string {
  const el = dom.document.querySelector(".app-composer-model-picker__select");
  return el?.textContent?.trim() ?? "";
}

async function openModelMenu(): Promise<HTMLElement[]> {
  const trigger = dom.document.querySelector(".app-composer-model-picker__select") as HTMLElement | null;
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.click();
    await sleep(60);
  });
  return Array.from(dom.document.querySelectorAll(".ant-dropdown-menu-item")) as HTMLElement[];
}

async function clickModel(label: string): Promise<void> {
  const items = await openModelMenu();
  const target = items.find((item) => item.textContent?.includes(label));
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
    await sleep(60);
  });
}

beforeEach(async () => {
  descriptors = GLOBAL_KEYS.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  dom = new Window();
  for (const key of Object.getOwnPropertyNames(dom)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get: () => (dom as unknown as Record<string, unknown>)[key],
      });
    } catch {
      /* ignore */
    }
  }
  for (const [key, value] of [
    ["window", dom],
    ["document", dom.document],
    ["IS_REACT_ACT_ENVIRONMENT", true],
    ["navigator", dom.navigator],
    ["getComputedStyle", dom.getComputedStyle.bind(dom)],
  ] as const) {
    Object.defineProperty(globalThis, key as string, { configurable: true, value });
  }
  dom.document.body.innerHTML = "";
  root = createRoot(dom.document.body.appendChild(dom.document.createElement("div")));
  seedModelProfileStoreCache(null);
  resetExecutionEngineModelListsForTests();
  resetExecutionEngineModelDefaultsForTests();
  globalThis.localStorage?.clear?.();
});

afterEach(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
  GLOBAL_KEYS.forEach((key, index) => {
    const descriptor = descriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, { configurable: true, value: descriptor.value });
    else Reflect.deleteProperty(globalThis, key);
  });
});

describe("DeepSeek Harness 模型选择", () => {
  test("默认模型（空值）时底栏展示 dsh 默认模型文案，而不是空白", async () => {
    await act(async () => root.render(<Host initialModel="" engine="deepseek" />));
    await act(async () => {
      await sleep(40);
    });
    expect(triggerLabel()).toBe("默认模型（dsh 配置）");
  });

  test("下拉列出 dsh 目录模型，点击一次即写回会话模型", async () => {
    await act(async () => root.render(<Host initialModel="" engine="deepseek" />));
    await act(async () => {
      await sleep(40);
    });
    await clickModel("DeepSeek-V4-Pro");
    expect(hostModel()).toBe(DEEPSEEK_V4_PRO);
    expect(triggerLabel()).toBe("DeepSeek-V4-Pro");
  });

  test("从 Codex 切到 DeepSeek 后仍可选择并切换模型", async () => {
    await act(async () => root.render(<EngineSwitchHost />));
    await act(async () => {
      await sleep(40);
    });
    const switchBtn = dom.document.querySelector(".switch-engine") as HTMLElement;
    await act(async () => {
      switchBtn.click();
      await sleep(60);
    });
    await clickModel("DeepSeek-V4-Pro");
    expect(hostModel()).toBe(DEEPSEEK_V4_PRO);
  });
});
