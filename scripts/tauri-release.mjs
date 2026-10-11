import { spawnSync } from "node:child_process";

// GitHub 未配置的 Secret 会成为空字符串；Tauri 将空 Apple 证书当作待导入证书。
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if ((name.startsWith("APPLE_") || name === "KEYCHAIN_PASSWORD") && !env[name]?.trim()) delete env[name];
}
const result = spawnSync("bun", ["tauri", ...process.argv.slice(2)], { env, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
