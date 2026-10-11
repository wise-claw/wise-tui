import { expect, test } from "bun:test";
// @ts-expect-error 发布脚本为独立 JavaScript 模块。
import { configureUpdater } from "./configure-updater.mjs";

test("发布配置启用签名更新并保留现有打包和插件能力", () => {
  const config = { bundle: { targets: "all", createUpdaterArtifacts: false }, plugins: { other: {}, updater: { endpoints: ["https://example.com/latest.json"], pubkey: "" } } };
  const next = configureUpdater(config, " public-key \n");
  expect(next.bundle).toEqual({ targets: "all", createUpdaterArtifacts: true });
  expect(next.plugins.updater).toEqual({ endpoints: ["https://example.com/latest.json"], pubkey: "public-key" });
  expect(next.plugins.other).toEqual({});
  expect(config.bundle.createUpdaterArtifacts).toBe(false);
});

test("缺少签名公钥时阻止发布不完整的更新包", () => {
  expect(() => configureUpdater({}, " ")).toThrow("TAURI_UPDATER_PUBLIC_KEY");
});
