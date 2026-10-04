import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeSession, ToolUsePart } from "../../types";
import { MessagePartsDisplay } from "./MessageParts";
import { SubagentMessagesProvider } from "./SubagentMessagesProvider";

const keys = ["window", "document", "navigator", "HTMLElement", "HTMLDivElement", "HTMLButtonElement",
  "SVGElement", "Element", "Node", "ShadowRoot", "Event", "MouseEvent", "getComputedStyle",
  "MutationObserver", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "localStorage",
  "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved: Record<string, unknown> = {};
let root: Root;
let host: HTMLElement;
let dom: Window;
let calls: { command: string; args: Record<string, unknown> }[];
let response: string[];
let readError: string | null;
const part: ToolUsePart = { type: "tool_use", id: "tool-1", name: "Task", status: "completed",
  input: { description: "检查配置", prompt: "审查配置" }, output: "agentId: a123" };
const session: ClaudeSession = { id: "main", claudeSessionId: "11111111-1111-1111-1111-111111111111",
  repositoryPath: "/repo", repositoryName: "repo", model: "", status: "completed", createdAt: 1,
  pendingPrompt: "", messages: [{ id: 1, role: "assistant", content: "", parts: [part], timestamp: 1 }] };

beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of keys) {
    saved[key] = (globalThis as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom as unknown as Record<string, unknown>)[key];
  }
  calls = [];
  readError = null;
  response = [JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "子代理审查完成" }] } })];
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (readError) throw new Error(readError);
      return response;
    },
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

async function openCard(selectedSession = session, selectedPart = part) {
  await act(async () => root.render(
    <SubagentMessagesProvider session={selectedSession}>
      <MessagePartsDisplay parts={[selectedPart]} streaming={false} />
    </SubagentMessagesProvider>,
  ));
  await act(async () => host.querySelector<HTMLButtonElement>(".app-subagent-card__view-messages")?.click());
  await settle();
}

test("没有独立记录时显示任务和结果，读取错误可重试", async () => {
  response = [];
  readError = "日志暂不可读";
  await openCard();
  expect(document.body.textContent).toContain("审查配置");
  expect(document.body.textContent).toContain("agentId: a123");
  expect(document.body.textContent).toContain("暂时无法读取子代理消息");
  readError = null;
  response = [JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "子代理审查完成" }] } })];
  const refresh = [...document.querySelectorAll("button")].find((button) => button.textContent === "刷新消息");
  await act(async () => refresh?.click());
  await settle();
  expect(document.body.textContent).toContain("子代理审查完成");
  expect(document.body.textContent).not.toContain("暂时无法读取子代理消息");
});

test("Codex 子代理读取原生线程记录", async () => {
  const codexPart: ToolUsePart = { ...part, name: "collab_spawnAgent", output: undefined,
    input: { prompt: "审查配置", receiverThreadIds: ["child-thread"], agentsStates: {
      "child-thread": { status: "completed", message: "子代理返回结果" },
    } } };
  await openCard({ ...session, executionEngine: "codex-rpc", messages: [
    { id: 1, role: "assistant", content: "", parts: [codexPart], timestamp: 1 },
  ] }, codexPart);
  expect(calls.find((call) => call.command === "load_native_cli_session_transcript")?.args).toMatchObject({
    engine: "codex", sessionId: "child-thread", projectPath: "/repo",
  });
  expect(document.body.textContent).toContain("子代理审查完成");
});

test("加载完整历史解除消息数量限制", async () => {
  response = Array.from({ length: 80 }, (_, i) => JSON.stringify({ type: "user", uuid: `user-${i}`,
    message: { role: "user", content: `历史提问 ${i}` } }));
  await openCard();
  const fullHistory = [...document.querySelectorAll("button")].find((button) => button.textContent === "加载完整历史");
  expect(fullHistory).toBeDefined();
  await act(async () => fullHistory?.click());
  await settle();
  expect(calls.at(-1)?.args.tailLines).toBeNull();
  expect(document.body.textContent).not.toContain("加载完整历史");
});

afterEach(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.cancelAsync();
  host.remove();
  for (const key of keys) (globalThis as Record<string, unknown>)[key] = saved[key];
});

async function settle() {
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    if (document.body.textContent?.includes("子代理审查完成")) return;
  }
}

test("消息卡片可查看子代理记录，虚拟行卸载后抽屉仍保持打开", async () => {
  await act(async () => root.render(
    <SubagentMessagesProvider session={session}>
      <MessagePartsDisplay parts={[part]} streaming={false} />
    </SubagentMessagesProvider>,
  ));
  const button = host.querySelector<HTMLButtonElement>(".app-subagent-card__view-messages");
  expect(button?.textContent).toBe("查看子代理");
  await act(async () => button?.click());
  await settle();
  expect(calls.find((call) => call.command === "load_claude_subagent_jsonl")?.args).toMatchObject({
    projectPath: "/repo", parentSessionId: session.claudeSessionId, toolUseId: "tool-1", agentId: "a123",
  });
  expect(document.body.textContent).toContain("子代理审查完成");
  await act(async () => root.render(<SubagentMessagesProvider session={session}><div>行已卸载</div></SubagentMessagesProvider>));
  expect(document.body.textContent).toContain("子代理审查完成");
  // 切换主会话时自动关闭，不能把上个会话的代理显示到新会话。
  await act(async () => root.render(<SubagentMessagesProvider session={{ ...session, id: "other" }}><div /></SubagentMessagesProvider>));
  expect(document.body.querySelector(".ant-drawer")).toBeNull();
});
