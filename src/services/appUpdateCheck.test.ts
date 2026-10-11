import { expect, test } from "bun:test";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkWiseUpdate, isNewerStableRelease } from "./appUpdateCheck";

function dependencies(tag: string, assets: string[], current = "1.4.0") {
  let checks = 0;
  const update = { version: "1.5.0" } as Update;
  return { deps: { getVersion: async () => current, fetch: (async () => Response.json({ tag_name: tag, assets: assets.map((name) => ({ name })) })) as typeof fetch, check: async () => { checks++; return update; } }, count: () => checks, update };
}

test("公开版本比本地旧且无清单时，正常返回无更新并跳过 updater", async () => {
  const { deps, count } = dependencies("v1.3.0", ["Wise.dmg"]);
  expect(await checkWiseUpdate(deps)).toEqual({ kind: "current", currentVersion: "1.4.0", latestVersion: "v1.3.0" });
  expect(count()).toBe(0);
});
test("新版无清单时提供手动更新，不访问不存在的清单", async () => {
  const { deps, count } = dependencies("v1.5.0", ["Wise.dmg"]);
  expect((await checkWiseUpdate(deps)).kind).toBe("manual");
  expect(count()).toBe(0);
});
test("新版有清单时继续使用签名 updater", async () => {
  const { deps, count, update } = dependencies("v1.5.0", ["latest.json"]);
  expect(await checkWiseUpdate(deps)).toEqual({ kind: "installable", update });
  expect(count()).toBe(1);
});
test("网络及发布源错误不能误报已是最新版", async () => {
  const { deps } = dependencies("v1.5.0", []);
  deps.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  await expect(checkWiseUpdate(deps)).rejects.toThrow("公开发布源不可用");
  deps.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
  await expect(checkWiseUpdate(deps)).rejects.toThrow("HTTP 403");
});
test("版本比较按数字，支持预发布本地版本，拒绝无效版本", () => {
  expect(isNewerStableRelease("v1.10.0", "1.9.0")).toBe(true);
  expect(isNewerStableRelease("1.4.0", "1.4.0-beta.1")).toBe(true);
  expect(isNewerStableRelease("1.4.0", "1.4.0+build.2")).toBe(false);
  expect(() => isNewerStableRelease("invalid", "1.4.0")).toThrow();
});


test("默认网络请求保留 Window receiver，不把 fetch 绑定到依赖对象", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async function (this: unknown) {
    if (this !== globalThis) throw new TypeError("Can only call Window.fetch on instances of Window");
    called = true;
    return Response.json({ tag_name: "v1.3.0", assets: [] });
  }) as typeof fetch;
  try {
    expect(await checkWiseUpdate({ getVersion: async () => "1.4.0" })).toEqual({ kind: "current", currentVersion: "1.4.0", latestVersion: "v1.3.0" });
    expect(called).toBe(true);
  } finally { globalThis.fetch = original; }
});
