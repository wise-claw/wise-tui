import { expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { HudCompletionToasts } from "./HudCompletionToasts";
import type { HudCompletionToastView } from "../../utils/hudCompletionToast";

test("completion card opens its own session and has an independent dismiss action", async () => {
  const toast: HudCompletionToastView = {
    id: "notice-a", sessionId: "session-b", title: "修复快捷键",
    message: "已完成修改", kind: "success", phase: "visible",
  };
  const selected: string[] = [];
  const dismissed: string[] = [];
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<HudCompletionToasts toasts={[toast]} queuedCount={2}
      onSelect={(item) => selected.push(item.sessionId)} onDismiss={(id) => dismissed.push(id)} />);
  });
  const buttons = renderer.root.findAllByType("button");
  await act(async () => buttons[0]!.props.onClick());
  expect(selected).toEqual(["session-b"]);
  expect(dismissed).toEqual([]);
  await act(async () => buttons[1]!.props.onClick());
  expect(dismissed).toEqual(["notice-a"]);
  expect(JSON.stringify(renderer.toJSON())).toContain("另有 ");
  await act(async () => renderer.unmount());
});
