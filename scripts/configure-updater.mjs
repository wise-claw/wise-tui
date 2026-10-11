import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function configureUpdater(config, publicKey) {
  const pubkey = publicKey?.trim();
  if (!pubkey) throw new Error("请在仓库 Actions Variables 中配置 TAURI_UPDATER_PUBLIC_KEY，并在 Secrets 中配置 TAURI_SIGNING_PRIVATE_KEY");
  return {
    ...config,
    bundle: { ...config.bundle, createUpdaterArtifacts: true },
    plugins: { ...config.plugins, updater: { ...config.plugins?.updater, pubkey } },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const config = configureUpdater(JSON.parse(readFileSync(path, "utf8")), process.env.TAURI_UPDATER_PUBLIC_KEY);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}
