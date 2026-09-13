import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeSession } from "../../types";
import type { ClaudeModelProfileStoreView } from "../../types/claudeModelProfile";

const flashProfile = {
  id: "flash",
  engine: "codex",
  company: "deepseek",
  name: "flash",
  modelId: "deepseek-flash",
  settingsJson: "{}",
  createdAtMs: 0,
  updatedAtMs: 0,
};
const v4ProProfile = {
  ...flashProfile,
  id: "v4pro",
  name: "v4-pro",
  modelId: "deepseek-v4-pro",
};

function mkStore(
  activeCodexProfileId: string | null,
  effectiveCodexModel: string | null,
  profiles: ClaudeModelProfileStoreView["profiles"] = [flashProfile, v4ProProfile],
): ClaudeModelProfileStoreView {
  return {
    profiles,
    activeProfileId: null,
    activeCodexProfileId,
    activeOpencodeProfileId: null,
    effectiveModel: null,
    effectiveCodexModel,
    effectiveOpencodeModel: null,
  };
}

/** 目录模型：`codex debug models` 的 GPT 目录 + 本机 config.toml 声明的模型。 */
const CODEX_CATALOG = [
  { id: "deepseek-flash", displayName: "deepseek-flash", provider: "deepseek" },
  { id: "deepseek-v4-pro", displayName: "deepseek-v4-pro", provider: "deepseek" },
  { id: "gpt-6-astra", displayName: "GPT-6-Astra", provider: "openai" },
];

let currentStore = mkStore("flash", "deepseek-flash");

const invokeMock = mock(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "get_claude_model_profile_store") return currentStore;
  if (cmd === "codex_list_models") return CODEX_CATALOG;
  if (cmd === "apply_claude_model_profile") {
    const profileId = String(args?.profileId ?? "");
    const profile = currentStore.profiles.find((item) => item.id === profileId);
    currentStore = mkStore(profileId, profile?.modelId ?? null, currentStore.profiles);
    return currentStore;
  }
  if (cmd === "apply_codex_runtime_model") {
    currentStore = mkStore(
      currentStore.activeCodexProfileId,
      String(args?.model ?? ""),
      currentStore.profiles,
    );
    return currentStore;
  }
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
import {
  resetExecutionEngineModelListsForTests,
  saveCachedCodexModels,
} from "../../services/executionEngineModelListCache";
import {
  resetExecutionEngineModelDefaultsForTests,
  saveExecutionEngineDefaultModel,
} from "../../services/executionEngineModelDefaults";

const GLOBAL_KEYS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT", "navigator"] as const;

let descriptors: Array<PropertyDescriptor | undefined>;
let dom: Window;
let root: Root;

function makeSession(model: string): ClaudeSession {
  return {
    id: "s1",
    claudeSessionId: "s1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    executionEngine: "codex-rpc",
    model,
    status: "idle",
    messages: [],
    createdAt: 0,
    pendingPrompt: "",
  } as ClaudeSession;
}

/**
 * 复刻 Composer 的接线：`session.model` 由会话宿主回写，Composer 自己持有 `model`。
 * `echo=false` 对应不回写 `session.model` 的宿主（HUD / 运行面板 drawer 的 `() => undefined`），
 * 此时任何「用会话模型反算」的同步都会把刚点的选择弹回去。
 */
function Host({
  initialModel,
  echo,
  echoDelayMs = 0,
  externalModel,
}: {
  initialModel: string;
  echo: boolean;
  /** 宿主回写 `session.model` 的延迟；>0 模拟主面板里滞后一拍的回写。 */
  echoDelayMs?: number;
  externalModel?: string;
}) {
  const [session, setSession] = useState<ClaudeSession>(() => makeSession(initialModel));
  const [model, setModel] = useComposerModelSelection(session.id, "codex-rpc", session.model);
  useEffect(() => {
    if (!externalModel) return;
    setSession((prev) => (prev.model === externalModel ? prev : { ...prev, model: externalModel }));
  }, [externalModel]);
  const onModelChange = useCallback(
    (next: string) => {
      setModel(next);
      if (!echo) return;
      const commit = () =>
        setSession((prev) => (prev.model === next ? prev : { ...prev, model: next }));
      if (echoDelayMs > 0) window.setTimeout(commit, echoDelayMs);
      else commit();
    },
    [echo, echoDelayMs, setModel],
  );
  return (
    <div>
      <span className="host-model">{model}</span>
      <ComposerModelPicker
        session={session}
        sessionExecutionEngine="codex-rpc"
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

async function clickModel(label: string): Promise<void> {
  const trigger = dom.document.querySelector(".app-composer-model-picker__select") as HTMLElement | null;
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.click();
    await sleep(30);
  });
  const items = Array.from(dom.document.querySelectorAll(".ant-dropdown-menu-item")) as HTMLElement[];
  const target = items.find((item) => item.textContent?.includes(label));
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
    await sleep(40);
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
  currentStore = mkStore("flash", "deepseek-flash");
  seedModelProfileStoreCache(null);
  resetExecutionEngineModelListsForTests();
  resetExecutionEngineModelDefaultsForTests();
  globalThis.localStorage?.clear?.();
  await saveCachedCodexModels(CODEX_CATALOG);
  await saveExecutionEngineDefaultModel("codex-rpc", "deepseek-flash");
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

describe("Codex 模型切换一次点击即生效", () => {
  test("档案行：宿主不回写 session.model 时不会被弹回旧模型", async () => {
    await act(async () => root.render(<Host initialModel="deepseek-flash" echo={false} />));
    await act(async () => {
      await sleep(20);
    });
    await clickModel("v4-pro");
    expect(hostModel()).toBe("deepseek-v4-pro");
    expect(currentStore.effectiveCodexModel).toBe("deepseek-v4-pro");
  });

  test("档案行：宿主回写 session.model 时同样一次点击生效", async () => {
    await act(async () => root.render(<Host initialModel="deepseek-flash" echo />));
    await act(async () => {
      await sleep(20);
    });
    await clickModel("v4-pro");
    expect(hostModel()).toBe("deepseek-v4-pro");
  });

  test("档案行：宿主回写滞后一拍时也不会被弹回旧模型", async () => {
    await act(async () => root.render(<Host initialModel="deepseek-flash" echo echoDelayMs={80} />));
    await act(async () => {
      await sleep(20);
    });
    await clickModel("v4-pro");
    expect(hostModel()).toBe("deepseek-v4-pro");
    await act(async () => {
      await sleep(120);
    });
    expect(hostModel()).toBe("deepseek-v4-pro");
  });

  test("目录模型（无 profileId）：一次点击生效", async () => {
    currentStore = mkStore(null, null, []);
    await act(async () => root.render(<Host initialModel="deepseek-flash" echo={false} />));
    await act(async () => {
      await sleep(20);
    });
    await clickModel("GPT-6-Astra");
    expect(hostModel()).toBe("gpt-6-astra");
  });

  test("会话模型被外部改动时显式选择让位（不被钉死）", async () => {
    await act(async () => root.render(<Host initialModel="deepseek-flash" echo />));
    await act(async () => {
      await sleep(20);
    });
    await clickModel("v4-pro");
    expect(hostModel()).toBe("deepseek-v4-pro");
    await act(async () => {
      root.render(<Host initialModel="deepseek-flash" echo externalModel="gpt-6-astra" />);
      await sleep(30);
    });
    expect(hostModel()).toBe("gpt-6-astra");
  });
});
