import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// GitHub 未配置的 Secret 会成为空字符串；Tauri 将空 Apple 证书当作待导入证书。
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if ((name.startsWith("APPLE_") || name === "KEYCHAIN_PASSWORD") && !env[name]?.trim()) delete env[name];
}
const result = spawnSync("bun", ["tauri", ...process.argv.slice(2)], { env, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) { console.error(result.error.message); process.exit(1); }
// 在 tauri-action 上传产物前校验完整应用包，避免仅有 linker 签名的包被发布。
if (result.status === 0 && process.platform === "darwin" && process.argv.includes("build")) {
  const targetRoot = env.CARGO_TARGET_DIR || "src-tauri/target";
  const roots = [targetRoot];
  if (existsSync(targetRoot)) {
    for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(targetRoot, entry.name));
    }
  }
  const bundles = roots.map((root) => join(root, "release/bundle/macos/Wise.app")).filter(existsSync);
  if (bundles.length === 0) {
    console.error("未找到 macOS 应用包，无法校验发布签名");
    process.exit(1);
  }
  for (const bundle of bundles) {
    const linkage = spawnSync("otool", ["-L", join(bundle, "Contents/MacOS/wise")], { encoding: "utf8" });
    if (linkage.error || linkage.status !== 0) {
      console.error("无法检查 macOS 应用的动态库依赖", linkage.error?.message || linkage.stderr);
      process.exit(1);
    }
    const externalLibraries = linkage.stdout.split("\n").slice(1)
      .map((line) => line.trim().split(" (compatibility version")[0])
      .filter((path) => path && !path.startsWith("/System/Library/") && !path.startsWith("/usr/lib/") && !path.startsWith("@"));
    if (externalLibraries.length) {
      console.error("macOS 应用依赖未打包的外部动态库，拒绝发布：", externalLibraries.join("\n"));
      process.exit(1);
    }
    const check = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle], { stdio: "inherit" });
    if (check.status !== 0) process.exit(check.status || 1);
  }
}
process.exit(result.status ?? 1);
