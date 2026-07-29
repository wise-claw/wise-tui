#!/usr/bin/env bun
/**
 * macOS：未配置 APPLE_SIGNING_IDENTITY 时默认 ad-hoc（`-`），让 bundler 对 .app
 * 做正式 codesign（绑定 Info.plist、写入 _CodeSignature）。
 *
 * 仅有 linker ad-hoc、未密封的 bundle 会导致 TCC「文稿」等授权无法跨启动记住。
 * CI / 本机若已设置 APPLE_SIGNING_IDENTITY（或 Developer ID），则不覆盖。
 */
import { spawnSync } from "node:child_process";

const env = { ...process.env };
if (process.platform === "darwin" && !env.APPLE_SIGNING_IDENTITY?.trim()) {
  env.APPLE_SIGNING_IDENTITY = "-";
  console.log(
    "[wise] macOS: APPLE_SIGNING_IDENTITY unset; using ad-hoc (-) so the .app is properly codesigned for TCC.",
  );
}

const result = spawnSync("tauri", ["build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
