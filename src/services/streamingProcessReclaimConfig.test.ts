import { describe, expect, test } from "bun:test";
import {
  defaultStreamingProcessReclaimConfig,
  normalizeStreamingProcessReclaimConfig,
  streamingProcessReclaimPolicyFromConfig,
} from "./streamingProcessReclaimConfig";

describe("streamingProcessReclaimConfig", () => {
  test("defaults: enabled, idle 10m, maxLive 10, scan 5m", () => {
    const d = defaultStreamingProcessReclaimConfig();
    expect(d.enabled).toBe(true);
    expect(d.idleMinutes).toBe(10);
    expect(d.maxLiveProcesses).toBe(10);
    expect(d.graceSeconds).toBe(60);
    expect(d.scanIntervalMs).toBe(5 * 60_000);
  });

  test("normalize clamps maxLive and idle", () => {
    expect(normalizeStreamingProcessReclaimConfig({ maxLiveProcesses: 99 }).maxLiveProcesses).toBe(32);
    expect(normalizeStreamingProcessReclaimConfig({ maxLiveProcesses: 0 }).maxLiveProcesses).toBe(1);
    expect(normalizeStreamingProcessReclaimConfig({ idleMinutes: 0 }).idleMinutes).toBe(1);
  });

  test("policy converts minutes/seconds to ms", () => {
    const policy = streamingProcessReclaimPolicyFromConfig(
      normalizeStreamingProcessReclaimConfig({
        idleMinutes: 10,
        maxLiveProcesses: 10,
        graceSeconds: 60,
      }),
    );
    expect(policy.idleMs).toBe(600_000);
    expect(policy.maxLiveProcesses).toBe(10);
    expect(policy.graceMs).toBe(60_000);
  });
});
