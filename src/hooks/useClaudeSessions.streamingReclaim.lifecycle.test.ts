import { expect, mock, test } from "bun:test";
import { defaultStreamingProcessReclaimConfig } from "../services/streamingProcessReclaimConfig";

const invoke = mock(async (..._args: unknown[]): Promise<void> => {});
mock.module("@tauri-apps/api/core", () => ({
  invoke, isTauri: () => false, transformCallback: () => 0,
  Channel: class {}, PluginListener: class {}, addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (path: string) => path,
}));
const { applyStreamingProcessReclaim, setStreamingProcessEntry } = await import("./useClaudeSessions.streamingReclaim");
type Params = Parameters<typeof applyStreamingProcessReclaim>[0];

function harness(): Params {
  const params: Params = {
    config: defaultStreamingProcessReclaimConfig(),
    streamingProcessByTab: new Map(), activityByTab: new Map(),
    sessions: [], getPendingCount: () => 0,
  };
  setStreamingProcessEntry(params.streamingProcessByTab, params.activityByTab, "idle", "sid", Date.now() - 3_600_000);
  return params;
}

test("periodic reclamation continues after an empty scan and across many completed passes", async () => {
  const empty = harness();
  empty.streamingProcessByTab.clear();
  expect(await applyStreamingProcessReclaim(empty)).toEqual([]);
  for (let i = 0; i < 100; i++) {
    const params = harness();
    expect(await applyStreamingProcessReclaim(params)).toEqual(["idle"]);
    expect(params.streamingProcessByTab.size).toBe(0);
    expect(params.activityByTab.size).toBe(0);
  }
});

test("a failed pass releases the lock and its rejection is delivered to the caller", async () => {
  const params = harness();
  params.detachSessionStream = () => { throw new Error("detach failed"); };
  await expect(applyStreamingProcessReclaim(params)).rejects.toThrow("detach failed");
  expect(await applyStreamingProcessReclaim(harness())).toEqual(["idle"]);
});

test("overlapping timer scans skip and queued spawn reclamation retains ownership until finished", async () => {
  const releases: Array<() => void> = [];
  invoke.mockImplementation(() => new Promise<void>((resolve) => { releases.push(resolve); }));
  try {
    const first = applyStreamingProcessReclaim(harness());
    await Promise.resolve();
    expect(await applyStreamingProcessReclaim(harness())).toEqual([]);
    const queued = applyStreamingProcessReclaim({ ...harness(), reserveSlotForSpawn: true });
    releases.shift()!();
    await first;
    // Wait for the queued pass to enter closeStreamingSession.
    while (releases.length === 0) await Promise.resolve();
    expect(await applyStreamingProcessReclaim(harness())).toEqual([]);
    releases.shift()!();
    expect(await queued).toEqual(["idle"]);
  } finally {
    for (const release of releases) release();
    invoke.mockImplementation(async () => {});
  }
  expect(await applyStreamingProcessReclaim(harness())).toEqual(["idle"]);
});
