import { expect, test } from "bun:test";
import { APP_UPDATE_CHECK_INTERVAL_MS, createAppUpdateAutoChecker } from "./appUpdateAutoCheck";

test("默认不检查，开启后每六小时复查，同一版本只提示一次", async () => {
  let now = 0;
  let checks = 0;
  let version = "1.5.0";
  const notices: string[] = [];
  const checker = createAppUpdateAutoChecker({ now: () => now, check: async () => { checks++; return { version }; }, onAvailable: (update) => notices.push(update.version) });
  await checker.tick();
  expect(checks).toBe(0);
  checker.setEnabled(true);
  await checker.tick();
  await checker.tick();
  expect(checks).toBe(1);
  now += APP_UPDATE_CHECK_INTERVAL_MS;
  await checker.tick();
  expect(checks).toBe(2);
  expect(notices).toEqual(["1.5.0"]);
  version = "1.6.0";
  now += APP_UPDATE_CHECK_INTERVAL_MS;
  await checker.tick();
  expect(notices).toEqual(["1.5.0", "1.6.0"]);
  checker.setEnabled(false);
  now += APP_UPDATE_CHECK_INTERVAL_MS;
  await checker.tick();
  expect(checks).toBe(3);
});

test("并发触发只检查一次，关闭后忽略检查中的结果", async () => {
  let resolve!: (value: { version: string }) => void;
  let checks = 0;
  const notices: string[] = [];
  const checker = createAppUpdateAutoChecker({ check: () => { checks++; return new Promise((done) => { resolve = done; }); }, onAvailable: (update) => notices.push(update.version) });
  checker.setEnabled(true);
  const pending = checker.tick();
  await checker.tick();
  expect(checks).toBe(1);
  checker.setEnabled(false);
  resolve({ version: "2.0.0" });
  await pending;
  expect(notices).toEqual([]);
});

test("停止后忽略检查结果并且不再触发检查", async () => {
  let resolve!: (value: { version: string }) => void;
  const notices: string[] = [];
  let checks = 0;
  const checker = createAppUpdateAutoChecker({ check: () => { checks++; return new Promise((done) => { resolve = done; }); }, onAvailable: (update) => notices.push(update.version) });
  checker.setEnabled(true);
  const pending = checker.tick();
  checker.stop();
  resolve({ version: "2.0.0" });
  await pending;
  await checker.tick();
  expect(notices).toEqual([]);
  expect(checks).toBe(1);
});

test("网络失败不产生通知，下个周期继续尝试", async () => {
  let now = 0;
  let checks = 0;
  const notices: string[] = [];
  const checker = createAppUpdateAutoChecker({ now: () => now, check: async () => { if (++checks === 1) throw new Error("offline"); return { version: "2.0.0" }; }, onAvailable: (update) => notices.push(update.version) });
  checker.setEnabled(true);
  await checker.tick();
  await checker.tick();
  expect(checks).toBe(1);
  expect(notices).toEqual([]);
  now += APP_UPDATE_CHECK_INTERVAL_MS;
  await checker.tick();
  expect(notices).toEqual(["2.0.0"]);
});

test("最新版本不弹通知", async () => {
  let notices = 0;
  const checker = createAppUpdateAutoChecker({ check: async () => null, onAvailable: () => { notices++; } });
  checker.setEnabled(true);
  await checker.tick();
  expect(notices).toBe(0);
});
