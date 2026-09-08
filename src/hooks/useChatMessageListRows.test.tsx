import { expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import type { ClaudeSession } from "../types";
import { useChatMessageListRows } from "./useChatMessageListRows";

function session(id: string): ClaudeSession {
  return {
    id, claudeSessionId: null, repositoryPath: `/repos/${id}`, repositoryName: id,
    model: "", status: "idle", createdAt: 1, pendingPrompt: "",
    messages: [{ id: `${id}-message`, role: "user", content: id, timestamp: 1 }],
  };
}

test("切回近期仓库复用消息列表，消息更新后不会复用旧正文", () => {
  let rows: ReturnType<typeof useChatMessageListRows> = [];
  function Probe({ value }: { value: ClaudeSession }) {
    rows = useChatMessageListRows(value);
    return null;
  }
  const a = session("a");
  const b = session("b");
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<Probe value={a} />); });
  const first = rows;
  act(() => { renderer.update(<Probe value={b} />); });
  expect(rows).not.toBe(first);
  act(() => { renderer.update(<Probe value={a} />); });
  expect(rows).toBe(first);
  const updated = { ...a, messages: [...a.messages, { ...a.messages[0]!, id: "new", content: "new" }] };
  act(() => { renderer.update(<Probe value={updated} />); });
  expect(rows).not.toBe(first);
  const latest = rows;
  act(() => { renderer.update(<Probe value={b} />); });
  act(() => { renderer.update(<Probe value={updated} />); });
  expect(rows).toBe(latest);
  act(() => { renderer.unmount(); });
});
