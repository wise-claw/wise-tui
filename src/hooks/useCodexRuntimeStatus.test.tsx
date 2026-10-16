import { afterEach, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const requests: Array<{ sessionId: string; resolve: (status: string) => void }> = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: (_command: string, args: { sessionId: string }) => new Promise<string>((resolve) => {
    requests.push({ sessionId: args.sessionId, resolve });
  }),
}));
const { useCodexRuntimeStatus } = await import("./useCodexRuntimeStatus");
let renderer: ReactTestRenderer | undefined;
let label = "";
function Probe({ id, busy = false, enabled = true }: { id: string; busy?: boolean; enabled?: boolean }) {
  label = useCodexRuntimeStatus(id, enabled, busy);
  return null;
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  requests.length = 0;
});

test("late status from another session cannot overwrite the active session", async () => {
  await act(async () => { renderer = create(<Probe id="a" />); });
  const old = requests[0];
  await act(async () => { renderer!.update(<Probe id="b" />); });
  expect(label).toBe("未连接");
  await act(async () => requests[1].resolve("ready"));
  expect(label).toBe("待命");
  await act(async () => old.resolve("running"));
  expect(label).toBe("待命");
});

test("connecting, running and resident readiness follow backend state", async () => {
  await act(async () => { renderer = create(<Probe id="a" busy />); });
  expect(label).toBe("连接中");
  await act(async () => requests[0].resolve("running"));
  expect(label).toBe("运行中");
  await act(async () => { renderer!.update(<Probe id="a" />); });
  await act(async () => requests[1].resolve("resident"));
  expect(label).toBe("常驻待命");
});

test("other engines do not start runtime polling", async () => {
  await act(async () => { renderer = create(<Probe id="a" enabled={false} />); });
  expect(requests).toHaveLength(0);
});
