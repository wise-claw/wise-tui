import { afterEach, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const invoke = mock(async (_command: string, _args: unknown) => undefined);
mock.module("@tauri-apps/api/core", () => ({ invoke }));
const { useCodexPersistentSession } = await import("./useCodexPersistentSession");
let renderer: ReactTestRenderer | undefined;
let api!: ReturnType<typeof useCodexPersistentSession>;
function Probe({ id }: { id: string }) { api = useCodexPersistentSession(id, true); return null; }
afterEach(async () => {
  await act(async () => renderer?.unmount());
  invoke.mockClear();
  invoke.mockImplementation(async () => undefined);
});

test("new sessions use ordinary recycling until explicitly selected", async () => {
  await act(async () => { renderer = create(<Probe id="ordinary" />); });
  expect(api.persistent).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("set_codex_rpc_persistent", { sessionId: "ordinary", persistent: false });
  await act(async () => api.setPersistent(true));
  expect(api.persistent).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("set_codex_rpc_persistent", { sessionId: "ordinary", persistent: true });
  await act(async () => api.setPersistent(false));
  expect(api.persistent).toBe(false);
});

test("rejected selection keeps ordinary mode and session switches do not carry selection", async () => {
  await act(async () => { renderer = create(<Probe id="a" />); });
  invoke.mockImplementationOnce(async () => { throw new Error("connection closed"); });
  await act(async () => { await expect(api.setPersistent(true)).rejects.toThrow("connection closed"); });
  expect(api.persistent).toBe(false);
  await act(async () => api.setPersistent(true));
  expect(api.persistent).toBe(true);
  await act(async () => renderer!.update(<Probe id="b" />));
  expect(api.persistent).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("set_codex_rpc_persistent", { sessionId: "b", persistent: false });
});
