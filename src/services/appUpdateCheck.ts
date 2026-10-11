import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";

export const WISE_RELEASES_URL = "https://github.com/wise-claw/wise-tui/releases";
const API_URL = "https://api.github.com/repos/wise-claw/wise-tui/releases/latest";
interface Release { tag_name: string; body?: string; assets: { name: string }[] }
export type WiseUpdateCheckResult =
  | { kind: "current"; currentVersion: string; latestVersion: string | null }
  | { kind: "manual"; version: string; body?: string }
  | { kind: "installable"; update: Update };

export function isNewerStableRelease(latest: string, current: string): boolean {
  const parse = (value: string) => /^(?:v)?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  const next = parse(latest);
  const local = parse(current);
  if (!next || !local || next[4]) throw new Error("无法识别发布版本号");
  for (let i = 1; i <= 3; i++) {
    if (Number(next[i]) !== Number(local[i])) return Number(next[i]) > Number(local[i]);
  }
  return Boolean(local[4]);
}

export async function checkWiseUpdate(dependencies: Partial<{
  getVersion: () => Promise<string>;
  fetch: typeof fetch;
  check: () => Promise<Update | null>;
}> = {}): Promise<WiseUpdateCheckResult> {
  const currentVersion = await (dependencies.getVersion ?? getVersion)();
  // WKWebView 要求 fetch 的 receiver 为 Window，不能把原生方法复制到依赖对象上调用。
  const fetchRelease = dependencies.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetchRelease(API_URL, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
    if (response.status === 404) throw new Error("公开发布源不可用或尚无稳定版本，请查看发布页面");
    if (!response.ok) throw new Error(`读取发布信息失败（HTTP ${response.status}）`);
    const release = await response.json() as Release;
    if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) throw new Error("发布信息格式无效");
    if (!isNewerStableRelease(release.tag_name, currentVersion)) return { kind: "current", currentVersion, latestVersion: release.tag_name };
    if (!release.assets.some((asset) => asset.name === "latest.json")) return { kind: "manual", version: release.tag_name, body: release.body };
  } finally { clearTimeout(timer); }
  const update = await (dependencies.check ?? (async () => (await import("@tauri-apps/plugin-updater")).check({ timeout: 20000 })))();
  return update ? { kind: "installable", update } : { kind: "current", currentVersion, latestVersion: null };
}
