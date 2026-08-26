#!/usr/bin/env node
/**
 * Wise Stagehand CLI + sidecar.
 * - No argv: JSON-lines RPC over stdin/stdout (Tauri sidecar).
 * - `wise browse <cmd>` / `wise-browse <cmd>`: one-shot CLI via local daemon.
 * - `--daemon`: unix-socket JSON-lines server sharing one browser session.
 */
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile, unlink, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseWiseBrowseArgv, WISE_BROWSE_HELP, formatCliOutput, resolveBrowseUrl } from "./argv.mjs";
import {
  evaluateCompare,
  evaluateState,
  interpretExpectPayload,
  parseSuiteDocument,
  buildSuiteReport,
  isAssertionFailure,
  formatMarkdownReport,
  summarizeLatestPointer,
  DEFAULT_ACCEPT_SUITE,
} from "./assert.mjs";
import {
  sanitizeAuthProfileName,
  looksLoggedIn,
  summarizeAuthState,
} from "./auth.mjs";

/** @type {null | { kind: "v3" | "v4"; stagehand: any; browser?: any; pageIndex: number; model?: string }} */
let session = null;

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function callFirst(target, names, args = []) {
  if (!target) throw new Error("目标对象不存在");
  for (const name of names) {
    const fn = target[name];
    if (typeof fn === "function") return await fn.apply(target, args);
  }
  throw new Error(`不支持方法 ${names.join("/")}`);
}

async function importStagehand() {
  return import("@browserbasehq/stagehand");
}

async function importZod() {
  try {
    return await import("zod/v4");
  } catch {
    return import("zod");
  }
}

async function activePage() {
  if (!session) throw new Error("浏览器会话未启动");
  if (session.kind === "v4") {
    const context = session.browser?.context ?? session.stagehand?.browser?.context;
    if (context?.activePage) {
      const page = await context.activePage();
      if (page) return page;
    }
    if (context?.pages) {
      const pages = await context.pages();
      return pages[session.pageIndex] ?? pages[0];
    }
  }
  const context = session.stagehand?.context;
  const pages = typeof context?.pages === "function" ? context.pages() : context?.pages ?? [];
  const list = await Promise.resolve(pages);
  const page = list[session.pageIndex] ?? list[0];
  if (!page) throw new Error("当前没有可用页面");
  return page;
}

async function listPages() {
  if (!session) throw new Error("浏览器会话未启动");
  if (session.kind === "v4") {
    const context = session.browser?.context ?? session.stagehand?.browser?.context;
    const pages = context?.pages ? await context.pages() : [];
    return pages;
  }
  const context = session.stagehand?.context;
  const pages = typeof context?.pages === "function" ? context.pages() : [];
  return await Promise.resolve(pages);
}

function locator(page, target) {
  if (!target) throw new Error("缺少目标选择器");
  if (typeof page.locator === "function") return page.locator(String(target));
  throw new Error("当前 Stagehand page 不支持 locator");
}

async function startSession(params = {}) {
  if (session) {
    return { alreadyRunning: true, kind: session.kind };
  }
  const mod = await importStagehand();
  const env = String(params.env ?? "local").toLowerCase();
  const headed = params.headed !== false;
  const persistAuth = params.persistAuth !== false && env !== "cdp";
  const authProfile = sanitizeAuthProfileName(params.authProfile || "default");
  const model = params.model ? String(params.model) : undefined;
  const apiKey = params.browserbaseApiKey || process.env.BROWSERBASE_API_KEY;
  const modelApiKey = params.modelApiKey || process.env.STAGEHAND_MODEL_API_KEY;
  let userDataDir = params.userDataDir ? String(params.userDataDir) : "";
  if (persistAuth && env === "local" && !userDataDir) {
    userDataDir = authProfileDir(authProfile);
    await mkdir(userDataDir, { recursive: true });
  }

  if (typeof mod.Stagehand?.create === "function") {
    let browser;
    if (env === "browserbase" || env === "remote") {
      if (!apiKey) throw new Error("Browserbase 模式需要 BROWSERBASE_API_KEY");
      if (!mod.browserbase?.launch) throw new Error("当前 SDK 不支持 browserbase.launch");
      browser = await mod.browserbase.launch({
        apiKey,
        projectId: params.browserbaseProjectId || process.env.BROWSERBASE_PROJECT_ID,
      });
    } else if (env === "cdp" && params.cdpUrl) {
      if (mod.localBrowser?.connect) {
        browser = await mod.localBrowser.connect({ cdpUrl: String(params.cdpUrl) });
      } else if (mod.localBrowser?.launch) {
        browser = await mod.localBrowser.launch({ cdpUrl: String(params.cdpUrl) });
      } else {
        throw new Error("当前 SDK 不支持 CDP 附着");
      }
    } else {
      if (!mod.localBrowser?.launch) throw new Error("当前 SDK 不支持 localBrowser.launch");
      const launchOpts = { headless: !headed };
      if (userDataDir) launchOpts.userDataDir = userDataDir;
      browser = await mod.localBrowser.launch(launchOpts);
    }
    const createOpts = { browser };
    if (model) {
      createOpts.model = modelApiKey ? { modelName: model, apiKey: modelApiKey } : model;
    }
    const stagehand = await mod.Stagehand.create(createOpts);
    session = { kind: "v4", stagehand, browser, pageIndex: 0, model, env, persistAuth, authProfile, userDataDir };
    await hydrateAuthIfNeeded(env, authProfile);
    return { kind: "v4", env, persistAuth, authProfile, userDataDir: userDataDir || null };
  }

  const Stagehand = mod.Stagehand;
  if (typeof Stagehand !== "function") {
    throw new Error("无法加载 Stagehand SDK");
  }
  const ctor = {
    env: env === "browserbase" || env === "remote" ? "BROWSERBASE" : "LOCAL",
    verbose: 0,
    disablePino: true,
  };
  if (apiKey) ctor.apiKey = apiKey;
  if (model) ctor.model = model;
  if (modelApiKey) ctor.modelClientOptions = { apiKey: modelApiKey };
  if (env !== "browserbase" && env !== "remote") {
    ctor.localBrowserLaunchOptions = {
      headless: !headed,
    };
    if (userDataDir) ctor.localBrowserLaunchOptions.userDataDir = userDataDir;
  }
  const stagehand = new Stagehand(ctor);
  await stagehand.init();
  session = { kind: "v3", stagehand, pageIndex: 0, model, env, persistAuth, authProfile, userDataDir };
  await hydrateAuthIfNeeded(env, authProfile);
  return { kind: "v3", env: ctor.env, persistAuth, authProfile, userDataDir: userDataDir || null };
}

async function stopSession() {
  const current = session;
  session = null;
  if (!current) return { stopped: false };
  try {
    await current.stagehand?.close?.();
  } catch {
    // ignore
  }
  try {
    await current.browser?.close?.();
  } catch {
    // ignore
  }
  return { stopped: true };
}

async function screenshot(params = {}) {
  const page = await activePage();
  const dir = process.env.STAGEHAND_SCREENSHOT_DIR || path.join(process.cwd(), "screenshots");
  await mkdir(dir, { recursive: true });
  const filePath = params.path
    ? String(params.path)
    : path.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
  const options = { path: filePath, fullPage: Boolean(params.fullPage) };
  const result = await callFirst(page, ["screenshot", "takeScreenshot"], [options]);
  return { path: filePath, result: result ?? null };
}

async function extractData(params) {
  if (!session) throw new Error("浏览器会话未启动");
  const instruction = String(params.instruction ?? "").trim();
  if (!instruction) throw new Error("extract 指令不能为空");
  const zmod = await importZod();
  const z = zmod.z ?? zmod.default ?? zmod;
  let schema;
  if (params.schema && typeof z.fromJSONSchema === "function") {
    schema = z.fromJSONSchema(params.schema);
  } else if (params.schema && z.object) {
    schema = z.any();
  }
  if (schema) {
    return await session.stagehand.extract(instruction, schema);
  }
  return await session.stagehand.extract(instruction);
}

async function snapshot(params = {}) {
  const page = await activePage();
  if (typeof page.snapshot === "function") {
    return await page.snapshot(params);
  }
  if (session?.stagehand?.observe) {
    const observed = await session.stagehand.observe(
      params.filter ? `find actionable elements matching ${params.filter}` : "find all actionable elements",
    );
    return observed;
  }
  const html = await callFirst(page, ["content", "html"], []);
  return { html: typeof html === "string" ? html.slice(0, 80_000) : html };
}

async function getField(params) {
  const page = await activePage();
  const field = String(params.field ?? "title");
  const target = params.target ? String(params.target) : "";
  if (field === "url") {
    return { value: page.url?.() ?? page.url ?? (await callFirst(page, ["url"], [])) };
  }
  if (field === "title") {
    return { value: await callFirst(page, ["title"], []) };
  }
  if (target) {
    const loc = locator(page, target);
    if (field === "text") return { value: await callFirst(loc, ["innerText", "textContent", "text"], []) };
    if (field === "html") return { value: await callFirst(loc, ["innerHTML", "html"], []) };
    if (field === "value") return { value: await callFirst(loc, ["inputValue", "value"], []) };
    if (field === "box") return { value: await callFirst(loc, ["boundingBox", "box"], []) };
  }
  if (field === "html") return { value: await callFirst(page, ["content"], []) };
  if (field === "text") {
    return {
      value: await page.evaluate?.(() => document.body?.innerText ?? "").catch(() => null),
    };
  }
  if (field === "markdown") {
    const text = await page.evaluate?.(() => document.body?.innerText ?? "").catch(() => "");
    return { value: text };
  }
  throw new Error(`不支持的 get 字段：${field}`);
}

async function runAssert(params = {}) {
  const spec = params.spec && typeof params.spec === "object" ? params.spec : params;
  const kind = spec.kind || (spec.state && spec.target && !spec.field ? "state" : "compare");
  if (kind === "state") {
    const state = String(spec.state ?? "visible");
    const probeState = state === "checked" ? "checked" : "visible";
    const result = await dispatch("is", { state: probeState, target: spec.target });
    const actual = Boolean(result?.value);
    return { ...evaluateState({ state, actual }), spec: { kind: "state", state, target: spec.target } };
  }
  const field = String(spec.field ?? "text");
  const got = await getField({ field, target: spec.target });
  return {
    ...evaluateCompare(got?.value, spec.op || "contains", spec.value),
    spec: { kind: "compare", field, op: spec.op || "contains", value: spec.value, target: spec.target },
    field,
  };
}

async function runExpect(params = {}) {
  const instruction = String(params.instruction ?? "").trim();
  if (!instruction) throw new Error("expect 指令不能为空");
  const extracted = await extractData({
    instruction: `判断当前页面是否满足以下验收条件，只根据页面可见内容回答：${instruction}`,
    schema: {
      type: "object",
      properties: {
        passed: { type: "boolean", description: "是否满足条件" },
        reason: { type: "string", description: "判断理由" },
      },
      required: ["passed", "reason"],
    },
  });
  const judged = interpretExpectPayload(extracted);
  return {
    passed: judged.passed,
    reason: judged.reason,
    message: judged.passed ? `通过：${instruction}` : `失败：${instruction}${judged.reason ? `。${judged.reason}` : ""}`,
    instruction,
    actual: judged.actual,
  };
}

async function dispatch(method, params = {}) {
  switch (method) {
    case "ping":
      return { pong: true, hasSession: Boolean(session) };
    case "start":
      return await startSession(params);
    case "stop":
      return await stopSession();
    case "status": {
      const pages = session ? await listPages().catch(() => []) : [];
      const page = session ? await activePage().catch(() => null) : null;
      return {
        running: Boolean(session),
        kind: session?.kind ?? null,
        model: session?.model ?? null,
        pageCount: pages.length,
        url: page?.url?.() ?? page?.url ?? null,
        title: page ? await callFirst(page, ["title"], []).catch(() => null) : null,
        auth: await collectAuthStatus(session?.authProfile).catch(() => null),
      };
    }
    case "metrics":
      if (!session) throw new Error("浏览器会话未启动");
      if (typeof session.stagehand.metrics === "function") return await session.stagehand.metrics();
      return session.stagehand.metrics ?? null;
    case "act":
      if (!session) throw new Error("浏览器会话未启动");
      if (params.action) return await session.stagehand.act(params.action);
      return await session.stagehand.act(String(params.instruction ?? ""));
    case "extract":
      return await extractData(params);
    case "observe":
      if (!session) throw new Error("浏览器会话未启动");
      return await session.stagehand.observe(String(params.instruction ?? ""));
    case "agent": {
      if (!session) throw new Error("浏览器会话未启动");
      if (typeof session.stagehand.agent !== "function") {
        throw new Error("当前 Stagehand 版本不含 agent()，请改用 Act / Observe 组合多步任务");
      }
      const agent = session.stagehand.agent({
        model: session.model,
      });
      return await agent.execute({
        instruction: String(params.instruction ?? ""),
        maxSteps: Number(params.maxSteps ?? 20),
      });
    }
    case "open": {
      const page = await activePage();
      const url = String(params.url ?? "").trim();
      if (!url) throw new Error("url 不能为空");
      return await callFirst(page, ["goto", "open"], [url, params.waitUntil ? { waitUntil: params.waitUntil } : undefined]);
    }
    case "reload":
      return await callFirst(await activePage(), ["reload"], []);
    case "back":
      return await callFirst(await activePage(), ["goBack", "back"], []);
    case "forward":
      return await callFirst(await activePage(), ["goForward", "forward"], []);
    case "click":
      return await callFirst(locator(await activePage(), params.target), ["click"], []);
    case "fill": {
      const loc = locator(await activePage(), params.target);
      const result = await callFirst(loc, ["fill"], [String(params.value ?? "")]);
      if (params.pressEnter) {
        const page = await activePage();
        await callFirst(page, ["keyPress", "keyboardPress", "press"], ["Enter"]).catch(async () => {
          await loc.press?.("Enter");
        });
      }
      return result;
    }
    case "select":
      return await callFirst(locator(await activePage(), params.target), ["selectOption", "select"], [String(params.value ?? "")]);
    case "type": {
      const page = await activePage();
      if (params.target) {
        return await callFirst(locator(page, params.target), ["type"], [String(params.text ?? ""), params.delay ? { delay: params.delay } : undefined]);
      }
      return await callFirst(page, ["type", "keyboardType"], [String(params.text ?? "")]);
    }
    case "press":
      return await callFirst(await activePage(), ["keyPress", "press", "keyboardPress"], [String(params.key ?? "Enter")]);
    case "upload":
      return await callFirst(locator(await activePage(), params.target), ["setInputFiles", "upload"], [String(params.file ?? "")]);
    case "highlight": {
      const loc = locator(await activePage(), params.target);
      if (typeof loc.highlight === "function") return await loc.highlight(params);
      await loc.evaluate?.((el) => {
        el.style.outline = "3px solid #ff4d4f";
      });
      return { highlighted: true };
    }
    case "mouseClick":
      return await callFirst((await activePage()).mouse ?? await activePage(), ["click"], [Number(params.x), Number(params.y), params.button ? { button: params.button } : undefined]);
    case "mouseHover":
      return await callFirst((await activePage()).mouse ?? await activePage(), ["move", "hover"], [Number(params.x), Number(params.y)]);
    case "mouseScroll":
      return await callFirst((await activePage()).mouse ?? await activePage(), ["wheel", "scroll"], [Number(params.dx), Number(params.dy)]);
    case "mouseDrag": {
      const mouse = (await activePage()).mouse;
      if (!mouse) throw new Error("当前 page 不支持 mouse");
      await mouse.move(Number(params.x1), Number(params.y1));
      await mouse.down();
      await mouse.move(Number(params.x2), Number(params.y2));
      await mouse.up();
      return { dragged: true };
    }
    case "get":
      return await getField(params);
    case "is": {
      const loc = locator(await activePage(), params.target);
      if (params.state === "checked") return { value: await callFirst(loc, ["isChecked"], []) };
      return { value: await callFirst(loc, ["isVisible", "visible"], []) };
    }
    case "assert":
      return await runAssert(params);
    case "expect":
      return await runExpect(params);
    case "evaluate": {
      const page = await activePage();
      const expression = String(params.expression ?? "");
      return await page.evaluate(expression);
    }
    case "runCode": {
      const page = await activePage();
      const context = session?.browser?.context ?? session?.stagehand?.context;
      const browser = session?.browser ?? session?.stagehand;
      const stagehand = session?.stagehand;
      const fn = new Function("page", "context", "browser", "stagehand", `return (async () => { ${String(params.code ?? "")} })();`);
      return await fn(page, context, browser, stagehand);
    }
    case "viewport": {
      const page = await activePage();
      return await callFirst(page, ["setViewportSize", "viewport"], [{ width: Number(params.width), height: Number(params.height) }]);
    }
    case "screenshot":
      return await screenshot(params);
    case "snapshot":
      return await snapshot(params);
    case "waitLoad": {
      const page = await activePage();
      const state = params.state || "load";
      if (typeof page.waitForLoadState === "function") return await page.waitForLoadState(state, { timeout: params.timeout });
      return await page.waitForTimeout?.(500);
    }
    case "waitSelector": {
      const page = await activePage();
      return await callFirst(page, ["waitForSelector"], [String(params.target), { state: params.state || "visible", timeout: params.timeout }]);
    }
    case "waitTimeout": {
      const ms = Number(params.ms ?? 1000);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { waited: ms };
    }
    case "tabList": {
      const pages = await listPages();
      const items = [];
      for (let i = 0; i < pages.length; i += 1) {
        const p = pages[i];
        items.push({
          index: i,
          url: p.url?.() ?? p.url ?? null,
          title: await callFirst(p, ["title"], []).catch(() => null),
        });
      }
      return items;
    }
    case "tabNew": {
      if (!session) throw new Error("浏览器会话未启动");
      const context = session.browser?.context ?? session.stagehand?.context;
      const page = await callFirst(context, ["newPage"], []);
      session.pageIndex = (await listPages()).length - 1;
      if (params.url) await callFirst(page, ["goto"], [String(params.url)]);
      return { index: session.pageIndex };
    }
    case "tabSwitch": {
      const pages = await listPages();
      const idx = Number(params.targetId);
      if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
        throw new Error("无效的标签索引");
      }
      session.pageIndex = idx;
      await pages[idx].bringToFront?.();
      return { index: idx };
    }
    case "tabClose": {
      const pages = await listPages();
      const idx = params.targetId == null || params.targetId === "" ? session.pageIndex : Number(params.targetId);
      const page = pages[idx];
      if (!page) throw new Error("找不到要关闭的标签");
      await page.close();
      session.pageIndex = Math.max(0, Math.min(session.pageIndex, pages.length - 2));
      return { closed: idx };
    }
    case "clipboardRead": {
      const context = session?.browser?.context ?? session?.stagehand?.context;
      if (context?.clipboard?.read) return await context.clipboard.read();
      const page = await activePage();
      return await page.evaluate?.(() => navigator.clipboard.readText());
    }
    case "clipboardWrite": {
      const context = session?.browser?.context ?? session?.stagehand?.context;
      const text = String(params.text ?? "");
      if (context?.clipboard?.write) return await context.clipboard.write(text);
      const page = await activePage();
      return await page.evaluate?.((value) => navigator.clipboard.writeText(value), text);
    }
    case "webmcpTools": {
      const page = await activePage();
      if (typeof page.tools !== "function") throw new Error("当前 Stagehand 版本不含 WebMCP page.tools()");
      const tools = await page.tools({ timeout: Number(params.timeout ?? 1000) });
      return (tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        frameId: tool.frameId,
      }));
    }
    case "webmcpInvoke": {
      const page = await activePage();
      if (typeof page.tools !== "function") throw new Error("当前 Stagehand 版本不含 WebMCP");
      const tools = await page.tools({ timeout: 3000 });
      const tool = (tools ?? []).find((item) => item.name === params.name);
      if (!tool) throw new Error(`未找到 WebMCP 工具 ${params.name}`);
      const invocation = await tool.invoke({ input: params.input ?? {} });
      return await invocation.result({ timeout: Number(params.timeout ?? 30_000) });
    }
    case "authStatus":
      return await collectAuthStatus(params.profile);
    case "authSave":
      return await saveAuthSnapshot(params.profile);
    case "authLoad":
      return await loadAuthSnapshot(params.profile);
    case "authWait":
      return await waitForLogin(params);
    case "authClear":
      return await clearAuthSnapshot(params.profile, params.purge === true);
    case "authList":
      return await listAuthSnapshots();
    case "authCookies": {
      const cookies = await readCookies();
      return {
        count: cookies.length,
        cookies: cookies.map((item) => ({
          name: item.name,
          domain: item.domain,
          path: item.path,
          httpOnly: item.httpOnly,
          secure: item.secure,
        })),
      };
    }
    default:
      throw new Error(`未知方法：${method}`);
  }
}

function serializeResult(result) {
  try {
    return JSON.parse(JSON.stringify(result ?? null));
  } catch {
    return String(result);
  }
}

async function handleRpc(method, params) {
  return serializeResult(await dispatch(method, params));
}

function handleStdinLine(line, writeFn) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    writeFn({ id: 0, ok: false, error: `非法 JSON：${error.message}` });
    return;
  }
  const id = request.id ?? 0;
  const method = String(request.method ?? "");
  const rawParams = request.params;
  const params =
    rawParams && typeof rawParams === "object" && !Array.isArray(rawParams) ? rawParams : {};
  Promise.resolve()
    .then(() => handleRpc(method, params))
    .then((result) => writeFn({ id, ok: true, result }))
    .catch((error) => writeFn({ id, ok: false, error: String(error?.message ?? error) }));
}

function automationDir() {
  return path.join(os.homedir(), ".wise", "stagehand-automation");
}

function authProfileDir(profile) {
  return path.join(automationDir(), "profiles", sanitizeAuthProfileName(profile));
}

function authStateFile(profile) {
  return path.join(automationDir(), "auth", `${sanitizeAuthProfileName(profile)}.json`);
}

async function activeContext() {
  if (!session) throw new Error("浏览器会话未启动");
  if (session.kind === "v4") {
    return session.browser?.context ?? session.stagehand?.browser?.context ?? session.stagehand?.context;
  }
  return session.stagehand?.context ?? session.stagehand?.browser?.context;
}

async function readCookies() {
  const context = await activeContext();
  if (typeof context?.cookies === "function") return await context.cookies();
  return [];
}

async function readStorageState() {
  const context = await activeContext();
  if (typeof context?.storageState === "function") return await context.storageState();
  return { cookies: await readCookies(), origins: [] };
}

async function applyStorageState(state) {
  const context = await activeContext();
  const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
  if (cookies.length && typeof context?.addCookies === "function") {
    await context.addCookies(cookies);
  }
  const origins = Array.isArray(state?.origins) ? state.origins : [];
  const page = await activePage().catch(() => null);
  if (!page?.evaluate) return { cookies: cookies.length, origins: origins.length };
  for (const origin of origins) {
    const items = Array.isArray(origin?.localStorage) ? origin.localStorage : [];
    if (!origin?.origin || items.length === 0) continue;
    try {
      await callFirst(page, ["goto", "open"], [origin.origin, { waitUntil: "domcontentloaded" }]);
      await page.evaluate((entries) => {
        for (const item of entries) {
          if (item?.name != null) localStorage.setItem(String(item.name), String(item.value ?? ""));
        }
      }, items);
    } catch {
      // origin restore is best-effort
    }
  }
  return { cookies: cookies.length, origins: origins.length };
}

async function snapshotExists(profile) {
  return existsSync(authStateFile(profile));
}

async function hydrateAuthIfNeeded(env, profile) {
  if (env === "cdp") return;
  const file = authStateFile(profile);
  if (!existsSync(file)) return;
  try {
    const cookies = await readCookies().catch(() => []);
    if (cookies.length > 0) return;
    const state = JSON.parse(await readFile(file, "utf8"));
    await applyStorageState(state);
  } catch {
    // snapshot hydrate is optional
  }
}

async function collectAuthStatus(profileName) {
  const profile = sanitizeAuthProfileName(profileName || session?.authProfile || "default");
  const persist = session ? session.persistAuth !== false : true;
  const env = session?.env || "local";
  let cookies = [];
  if (session) {
    cookies = await readCookies().catch(() => []);
  }
  const snapshot = await snapshotExists(profile);
  let snapshotCookies = 0;
  if (snapshot) {
    try {
      const state = JSON.parse(await readFile(authStateFile(profile), "utf8"));
      snapshotCookies = Array.isArray(state.cookies) ? state.cookies.length : 0;
    } catch {
      snapshotCookies = 0;
    }
  }
  const cookieCount = cookies.length || snapshotCookies;
  const domains = [...new Set(cookies.map((item) => item.domain).filter(Boolean))].slice(0, 8);
  const payload = {
    persist,
    profile,
    env,
    running: Boolean(session),
    snapshot,
    snapshotPath: snapshot ? authStateFile(profile) : null,
    userDataDir: session?.userDataDir || (persist && env === "local" ? authProfileDir(profile) : null),
    cookieCount,
    domains,
  };
  payload.summary = summarizeAuthState(payload);
  return payload;
}

async function saveAuthSnapshot(profileName) {
  const profile = sanitizeAuthProfileName(profileName || session?.authProfile || "default");
  const state = await readStorageState();
  const file = authStateFile(profile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const cookieCount = Array.isArray(state.cookies) ? state.cookies.length : 0;
  return { path: file, profile, cookieCount };
}

async function loadAuthSnapshot(profileName) {
  const profile = sanitizeAuthProfileName(profileName || session?.authProfile || "default");
  const file = authStateFile(profile);
  if (!existsSync(file)) throw new Error(`没有登录态快照：${file}。先在有窗口时登录并执行 wise browse auth save`);
  const state = JSON.parse(await readFile(file, "utf8"));
  const applied = await applyStorageState(state);
  return { path: file, profile, ...applied };
}

async function clearAuthSnapshot(profileName, purge) {
  const profile = sanitizeAuthProfileName(profileName || "default");
  const file = authStateFile(profile);
  if (existsSync(file)) await unlink(file);
  if (purge) {
    if (session) throw new Error("请先 wise browse stop，再清除持久档案目录");
    const dir = authProfileDir(profile);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
  return { profile, cleared: true, purge: Boolean(purge) };
}

async function listAuthSnapshots() {
  const dir = path.join(automationDir(), "auth");
  const names = await readdir(dir).catch(() => []);
  const items = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const file = path.join(dir, name);
    try {
      const state = JSON.parse(await readFile(file, "utf8"));
      items.push({
        profile: name.replace(/\.json$/, ""),
        path: file,
        cookieCount: Array.isArray(state.cookies) ? state.cookies.length : 0,
      });
    } catch {
      items.push({ profile: name.replace(/\.json$/, ""), path: file, cookieCount: 0 });
    }
  }
  return { count: items.length, items };
}

async function waitForLogin(params = {}) {
  const profile = sanitizeAuthProfileName(params.profile || session?.authProfile || "default");
  const timeout = Number(params.timeout ?? 180_000);
  const target = params.target || params.selector;
  const page = await activePage();
  const startUrl = page?.url?.() ?? page?.url ?? "";
  const startCookies = await readCookies().catch(() => []);
  const deadline = Date.now() + Math.max(5_000, timeout);
  let last = looksLoggedIn({ url: startUrl, cookies: startCookies, startUrl, startCookieCount: startCookies.length });
  while (Date.now() < deadline) {
    if (target) {
      try {
        const probe = await dispatch("is", { state: "visible", target });
        if (probe?.value) {
          last = { ok: true, reason: `已出现 ${target}` };
          break;
        }
      } catch {
        // keep waiting
      }
    }
    const url = page?.url?.() ?? page?.url ?? "";
    const cookies = await readCookies().catch(() => []);
    last = looksLoggedIn({ url, cookies, startUrl, startCookieCount: startCookies.length });
    if (last.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!last.ok) throw new Error(`等待登录超时：${last.reason}`);
  const saved = await saveAuthSnapshot(profile);
  return { ...last, ...saved };
}

function socketPath() {
  return process.env.WISE_BROWSE_SOCK || path.join(automationDir(), "daemon.sock");
}

function pidPath() {
  return path.join(automationDir(), "daemon.pid");
}

function configPath() {
  return process.env.WISE_BROWSE_CONFIG || path.join(automationDir(), "config.json");
}

async function loadCliConfig() {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDaemonPid() {
  try {
    const pid = Number((await readFile(pidPath(), "utf8")).trim());
    return Number.isInteger(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function connectSocket(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath());
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("连接浏览器守护进程超时"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function callDaemon(method, params, timeoutMs = 180_000) {
  const socket = await connectSocket();
  return await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("浏览器命令超时"));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      const line = buf.slice(0, nl).trim();
      socket.end();
      try {
        const parsed = JSON.parse(line);
        if (parsed.ok) resolve(parsed.result);
        else reject(new Error(parsed.error || "daemon 返回错误"));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(`${JSON.stringify({ id: 1, method, params: params ?? {} })}\n`);
  });
}

async function daemonReachable() {
  try {
    const socket = await connectSocket(400);
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function spawnDaemon() {
  await mkdir(automationDir(), { recursive: true });
  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [script, "--daemon"], {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(script),
    env: {
      ...process.env,
      STAGEHAND_SCREENSHOT_DIR:
        process.env.STAGEHAND_SCREENSHOT_DIR || path.join(automationDir(), "screenshots"),
    },
  });
  child.unref();
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await daemonReachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("无法启动浏览器守护进程。请先在右上角安装 CLI 依赖。");
}

async function ensureDaemon() {
  if (await daemonReachable()) return;
  const pid = await readDaemonPid();
  if (!isPidAlive(pid) && existsSync(socketPath())) {
    try {
      await unlink(socketPath());
    } catch {
      // ignore
    }
  }
  await spawnDaemon();
}

async function runDaemonServer() {
  await mkdir(automationDir(), { recursive: true });
  const sock = socketPath();
  if (existsSync(sock)) {
    try {
      await unlink(sock);
    } catch {
      // ignore
    }
  }
  const server = net.createServer((socket) => {
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    rl.on("line", (line) => {
      handleStdinLine(line, (payload) => {
        try {
          socket.write(`${JSON.stringify(payload)}\n`);
        } catch {
          // ignore
        }
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.listen(sock, resolve);
    server.once("error", reject);
  });
  await writeFile(pidPath(), `${process.pid}\n`, "utf8");
  const shutdown = async () => {
    await stopSession().catch(() => {});
    try {
      server.close();
    } catch {
      // ignore
    }
    try {
      await unlink(sock);
    } catch {
      // ignore
    }
    try {
      await unlink(pidPath());
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function runStdinRpc() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => handleStdinLine(line, send));
  rl.on("close", async () => {
    await stopSession().catch(() => {});
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await stopSession().catch(() => {});
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await stopSession().catch(() => {});
    process.exit(0);
  });
}

async function whichBrowse() {
  const parts = String(process.env.PATH ?? "").split(path.delimiter);
  for (const dir of parts) {
    const candidate = path.join(dir, process.platform === "win32" ? "browse.cmd" : "browse");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function runBrowsePassthrough(args) {
  const browse = await whichBrowse();
  if (!browse) {
    throw new Error("未找到 browse CLI。云端 / Skills 命令需要：npm install -g browse");
  }
  const child = spawn(browse, ["--json", "--session", "wise-cli", ...args], {
    stdio: "inherit",
    env: { ...process.env, BROWSE_LOAD_DOTENV: "0" },
  });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function ensureSession(parsed) {
  if (!parsed.needsSession) return;
  const ping = await callDaemon("ping", {});
  if (ping?.hasSession) return;
  const config = await loadCliConfig();
  await callDaemon("start", {
    env: config.env ?? "local",
    headed: config.headed !== false,
    persistAuth: config.persistAuth !== false,
    authProfile: config.authProfile || "default",
    model: config.model || undefined,
    modelApiKey: config.modelApiKey || undefined,
    browserbaseApiKey: config.browserbaseApiKey || undefined,
    browserbaseProjectId: config.browserbaseProjectId || undefined,
    cdpUrl: config.cdpUrl || undefined,
  });
  const defaultUrl = resolveBrowseUrl(String(config.url ?? "").trim());
  if (defaultUrl && parsed.method !== "open" && parsed.method !== "start") {
    await callDaemon("open", { url: defaultUrl }).catch(() => {});
  }
}

async function loadSuiteFromParsed(parsed) {
  if (parsed.suite) return parsed.suite;
  const file = String(parsed.file ?? "").trim();
  if (!file) {
    throw new Error("accept / test 需要 --file 套件或 --check 列表");
  }
  const raw = await readFile(file, "utf8");
  const suite = parseSuiteDocument(JSON.parse(raw));
  if (parsed.url && suite.steps[0]?.action !== "open") {
    suite.steps.unshift({
      id: "open-cli",
      action: "open",
      url: parsed.url,
      label: `打开 ${parsed.url}`,
    });
  }
  if (parsed.screenshotOnFail === false) suite.screenshotOnFail = false;
  if (parsed.stopOnFail === true) suite.stopOnFail = true;
  if (parsed.name) suite.name = parsed.name;
  if (Number.isFinite(Number(parsed.retries))) suite.retries = Math.max(0, Number(parsed.retries));
  return suite;
}

async function executeSuiteStep(step) {
  const item = {
    id: step.id,
    action: step.action,
    label: step.label,
    passed: true,
    message: "",
    soft: step.soft === true,
  };
  if (step.action === "open") {
    const url = resolveBrowseUrl(step.url) || step.url;
    await callDaemon("open", { url });
    item.message = `已打开 ${url}`;
    return item;
  }
  if (step.action === "wait") {
    if (step.target) {
      await callDaemon("waitSelector", {
        target: step.target,
        state: step.state || "visible",
        timeout: step.ms || undefined,
      });
      item.message = `已等待 ${step.target}`;
    } else {
      const ms = Number(step.ms) || 1000;
      await callDaemon("waitTimeout", { ms });
      item.message = `已等待 ${ms}ms`;
    }
    return item;
  }
  if (step.action === "screenshot") {
    const shot = await callDaemon("screenshot", {
      fullPage: step.fullPage !== false,
      path: step.path,
    });
    item.message = shot?.path ? `截图 ${shot.path}` : "已截图";
    item.screenshot = shot?.path ?? shot;
    return item;
  }
  if (step.action === "act") {
    await callDaemon("act", { instruction: step.instruction });
    item.message = `已操作：${step.instruction}`;
    return item;
  }
  if (step.action === "expect") {
    const result = await callDaemon("expect", { instruction: step.instruction });
    return { ...item, ...result, passed: result.passed !== false, soft: step.soft === true };
  }
  if (step.action === "assert") {
    const result = await callDaemon("assert", step.spec);
    return { ...item, ...result, passed: result.passed !== false, soft: step.soft === true };
  }
  throw new Error(`未知步骤：${step.action}`);
}

async function runSuiteStep(step, suiteRetries) {
  const retries = Number.isFinite(Number(step.retries))
    ? Math.max(0, Number(step.retries))
    : Math.max(0, Number(suiteRetries) || 0);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const started = Date.now();
    try {
      last = await executeSuiteStep(step);
    } catch (error) {
      last = {
        id: step.id,
        action: step.action,
        label: step.label,
        passed: false,
        message: String(error?.message ?? error),
        soft: step.soft === true,
      };
    }
    last.durationMs = Date.now() - started;
    last.attempt = attempt + 1;
    if (last.passed !== false) return last;
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return last;
}

async function writeSuiteArtifacts(report) {
  const dir = path.join(automationDir(), "reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(dir, `${stamp}-${report.kind}.json`);
  const mdPath = path.join(dir, `${stamp}-${report.kind}.md`);
  report.reportPath = jsonPath;
  report.markdownPath = mdPath;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatMarkdownReport(report), "utf8");
  await writeFile(
    path.join(dir, "latest.json"),
    `${JSON.stringify(summarizeLatestPointer(report), null, 2)}\n`,
    "utf8",
  );
  return report;
}

async function runSuiteCli(parsed) {
  const suite = await loadSuiteFromParsed(parsed);
  await ensureDaemon();
  await ensureSession({
    needsSession: true,
    method: suite.steps[0]?.action === "open" ? "open" : "assert",
  });
  const results = [];
  for (const step of suite.steps) {
    const item = await runSuiteStep(step, suite.retries);
    if (item.passed === false && suite.screenshotOnFail && !item.screenshot) {
      try {
        const shot = await callDaemon("screenshot", { fullPage: true });
        item.screenshot = shot?.path ?? shot;
      } catch {
        // evidence is best-effort
      }
    }
    results.push(item);
    const hardFail = item.passed === false && item.soft !== true;
    if (hardFail && suite.stopOnFail) break;
  }
  const report = buildSuiteReport({
    kind: parsed.suiteKind,
    name: suite.name,
    results,
    screenshotOnFail: suite.screenshotOnFail,
  });
  try {
    await writeSuiteArtifacts(report);
  } catch {
    // report file is optional if home is not writable
  }
  process.stdout.write(`${JSON.stringify(formatCliOutput(parsed.suiteKind, report), null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function runReportCli(parsed) {
  const dir = path.join(automationDir(), "reports");
  if (parsed.action === "list") {
    const names = await readdir(dir).catch(() => []);
    const jsons = names
      .filter((name) => name.endsWith(".json") && name !== "latest.json")
      .sort()
      .reverse()
      .slice(0, 20);
    const items = [];
    for (const name of jsons) {
      try {
        const report = JSON.parse(await readFile(path.join(dir, name), "utf8"));
        items.push({
          name: report.name,
          passed: report.passed,
          summary: report.summary,
          at: report.at,
          path: path.join(dir, name),
        });
      } catch {
        // skip unreadable reports
      }
    }
    process.stdout.write(
      `${JSON.stringify(formatCliOutput("report", { action: "list", count: items.length, items }), null, 2)}\n`,
    );
    return;
  }
  const pointerPath = path.join(dir, "latest.json");
  try {
    const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
    let report = pointer;
    if (pointer.jsonPath) {
      try {
        report = { ...JSON.parse(await readFile(pointer.jsonPath, "utf8")), ...pointer };
      } catch {
        // pointer is enough for the summary
      }
    }
    process.stdout.write(`${JSON.stringify(formatCliOutput("report", { found: true, ...report }), null, 2)}\n`);
    if (report.passed === false) process.exitCode = 1;
  } catch {
    process.stdout.write(
      `${JSON.stringify(formatCliOutput("report", { found: false, summary: "还没有验收报告" }), null, 2)}\n`,
    );
  }
}

async function runInitCli(parsed) {
  const file = path.resolve(String(parsed.file || "login.accept.json"));
  if (existsSync(file) && parsed.force !== true) {
    throw new Error(`套件已存在：${file}。加 --force 覆盖`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(DEFAULT_ACCEPT_SUITE, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify(formatCliOutput("init", { path: file, name: DEFAULT_ACCEPT_SUITE.name }), null, 2)}\n`,
  );
}

async function runCli(argv) {
  const parsed = parseWiseBrowseArgv(argv);
  if (parsed.kind === "help") {
    process.stdout.write(`${WISE_BROWSE_HELP}\n`);
    return;
  }
  if (parsed.kind === "daemon") {
    await runDaemonServer();
    return;
  }
  if (parsed.kind === "error") {
    throw new Error(parsed.error);
  }
  if (parsed.kind === "browse") {
    await runBrowsePassthrough(parsed.args);
    return;
  }
  if (parsed.kind === "suite") {
    await runSuiteCli(parsed);
    return;
  }
  if (parsed.kind === "report") {
    await runReportCli(parsed);
    return;
  }
  if (parsed.kind === "init") {
    await runInitCli(parsed);
    return;
  }
  const skipDaemon =
    parsed.method === "status" ||
    parsed.method === "stop" ||
    parsed.method === "ping" ||
    parsed.method === "authStatus" ||
    parsed.method === "authList" ||
    parsed.method === "authClear";
  if (skipDaemon && !(await daemonReachable())) {
    if (parsed.method === "status") {
      process.stdout.write(
        `${JSON.stringify(formatCliOutput("status", { running: false, kind: null, url: null, title: null, pageCount: 0 }, { running: false }), null, 2)}\n`,
      );
      return;
    }
    if (parsed.method === "stop") {
      process.stdout.write(`${JSON.stringify(formatCliOutput("stop", { stopped: false }), null, 2)}\n`);
      return;
    }
    if (parsed.method === "authStatus") {
      const result = await collectAuthStatus(parsed.params?.profile);
      process.stdout.write(`${JSON.stringify(formatCliOutput("authStatus", result), null, 2)}\n`);
      return;
    }
    if (parsed.method === "authList") {
      const result = await listAuthSnapshots();
      process.stdout.write(`${JSON.stringify(formatCliOutput("authList", result), null, 2)}\n`);
      return;
    }
    if (parsed.method === "authClear") {
      const result = await clearAuthSnapshot(parsed.params?.profile, parsed.params?.purge === true);
      process.stdout.write(`${JSON.stringify(formatCliOutput("authClear", result), null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ pong: true, hasSession: false }, null, 2)}\n`);
    return;
  }
  await ensureDaemon();
  await ensureSession(parsed);
  const waitMs =
    parsed.method === "authWait"
      ? Math.max(180_000, Number(parsed.params?.timeout ?? 180_000) + 15_000)
      : 180_000;
  const result = await callDaemon(parsed.method, parsed.params, waitMs);
  let page = null;
  if (parsed.method === "status" && result && typeof result === "object") {
    page = result;
  } else if (parsed.method !== "stop" && parsed.method !== "ping") {
    page = await callDaemon("status", {}).catch(() => null);
  }
  process.stdout.write(`${JSON.stringify(formatCliOutput(parsed.method, result, page), null, 2)}\n`);
  if ((parsed.method === "assert" || parsed.method === "expect") && isAssertionFailure(result)) {
    process.exitCode = 1;
  }
  if (parsed.method === "stop") {
    const pid = await readDaemonPid();
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

const cliArgv = process.argv.slice(2);
if (cliArgv.length > 0) {
  runCli(cliArgv).catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  });
} else {
  runStdinRpc();
}
