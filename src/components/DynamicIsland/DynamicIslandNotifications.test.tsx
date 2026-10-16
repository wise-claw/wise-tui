import { expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { DynamicIslandNotifications } from "./DynamicIslandNotifications";

test("island opens the correct completed session, exposes pending count and supports separate dismiss", async () => {
  const opened: string[] = [];
  const closed: string[] = [];
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<DynamicIslandNotifications toasts={[{ id: "notice", sessionId: "task", title: "需求实现", kind: "success", message: "已完成", phase: "visible" }]}
      queuedCount={3} onSelect={(sessionId) => opened.push(sessionId)} onDismiss={(id) => closed.push(id)} />);
  });
  const [open, close] = view.root.findAllByType("button");
  await act(async () => open!.props.onClick());
  expect(opened).toEqual(["task"]);
  expect(closed).toEqual([]);
  await act(async () => close!.props.onClick());
  expect(closed).toEqual(["notice"]);
  expect(view.root.findByProps({ className: "app-island-card__count" }).children).toEqual(["+", "3"]);
  await act(async () => view.unmount());
});
