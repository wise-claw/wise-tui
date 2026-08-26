import { invoke } from "@tauri-apps/api/core";
import {
  STAGEHAND_COMMANDS,
  buildBrowseArgv,
  buildSidecarParams,
  sanitizeBrowseSessionName,
  type StagehandCommandSpec,
  type StagehandFormValues,
} from "./stagehandBrowseCatalog";

export { resolveBrowseUrl } from "../../stagehand-cli/argv.mjs";

export type StagehandBrowseProbe = {
  browseAvailable: boolean;
  browseBinary: string | null;
  browseVersion: string | null;
  sidecarAvailable: boolean;
  sidecarDir: string | null;
  sidecarReady: boolean;
  runtime: string | null;
  hasBrowserbaseKey: boolean;
  cliAvailable: boolean;
  cliBinary: string | null;
  skillInstalled: boolean;
  configPath: string | null;
  error: string | null;
};

export type StagehandBrowseExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type StagehandStartOptions = {
  env?: "local" | "browserbase" | "cdp";
  headed?: boolean;
  model?: string;
  modelApiKey?: string;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  cdpUrl?: string;
  url?: string;
};

export type StagehandEnvVars = Record<string, string>;

export function formatStagehandResult(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type StagehandPageStatus = {
  running: boolean;
  url: string | null;
  title: string | null;
  pageCount: number;
};

export function parseStagehandPageStatus(value: unknown): StagehandPageStatus {
  const obj = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const url = typeof obj.url === "string" && obj.url.trim() ? obj.url.trim() : null;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : null;
  const pageCount = typeof obj.pageCount === "number" && Number.isFinite(obj.pageCount)
    ? obj.pageCount
    : 0;
  return {
    running: obj.running === true,
    url,
    title,
    pageCount,
  };
}

export type StagehandObserveAction = {
  selector?: string;
  description?: string;
  method?: string;
  arguments?: unknown[];
  raw: unknown;
};

function asObserveAction(value: unknown): StagehandObserveAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return { description: value.trim(), raw: value };
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  const selector = typeof obj.selector === "string" ? obj.selector : undefined;
  const description =
    typeof obj.description === "string"
      ? obj.description
      : typeof obj.instruction === "string"
        ? obj.instruction
        : undefined;
  const method = typeof obj.method === "string" ? obj.method : undefined;
  const args = Array.isArray(obj.arguments) ? obj.arguments : undefined;
  if (!selector && !description && !method) return { raw: value };
  return { selector, description, method, arguments: args, raw: value };
}

export function parseObserveActions(value: unknown): StagehandObserveAction[] {
  if (Array.isArray(value)) {
    return value.map(asObserveAction).filter((item): item is StagehandObserveAction => item != null);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.data)) return parseObserveActions(obj.data);
    if (obj.data && typeof obj.data === "object" && Array.isArray((obj.data as { actions?: unknown }).actions)) {
      return parseObserveActions((obj.data as { actions: unknown }).actions);
    }
    if (Array.isArray(obj.actions)) return parseObserveActions(obj.actions);
  }
  return [];
}

export function splitBrowseRawArgs(line: string): string[] {
  const text = line.trim();
  if (!text) return [];
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

export function unwrapBrowseExecResult(result: StagehandBrowseExecResult): unknown {
  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(detail || `browse 退出码 ${result.exitCode}`);
  }
  const stdout = result.stdout.trim();
  if (!stdout) return result.stderr.trim() || { ok: true };
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return stdout;
  }
}

export const WISE_BROWSE_SESSION_EXAMPLES = [
  { label: "打开谷歌官网", text: "打开谷歌官网" },
  { label: "截一张图", text: "截一张图" },
  { label: "这一页标题是什么", text: "这一页标题是什么" },
] as const;

export type BrowseReadinessItem = {
  id: "runtime" | "cli" | "skill";
  label: string;
  ok: boolean;
  detail: string;
};

export function buildBrowseReadiness(probe: StagehandBrowseProbe | null): BrowseReadinessItem[] {
  if (!probe) {
    return [
      { id: "runtime", label: "运行时", ok: false, detail: "检测中" },
      { id: "cli", label: "CLI", ok: false, detail: "检测中" },
      { id: "skill", label: "Skill", ok: false, detail: "检测中" },
    ];
  }
  return [
    {
      id: "runtime",
      label: "运行时",
      ok: probe.sidecarReady,
      detail: probe.sidecarReady ? probe.runtime || "已就绪" : probe.error || "未安装依赖",
    },
    {
      id: "cli",
      label: "CLI",
      ok: probe.cliAvailable,
      detail: probe.cliAvailable
        ? probe.cliBinary || "wise browse 已在 PATH"
        : "未安装，会话里还不能调用 wise browse",
    },
    {
      id: "skill",
      label: "Skill",
      ok: probe.skillInstalled,
      detail: probe.skillInstalled ? "已挂到用户技能目录" : "未挂载，助手可能不会自动调用 CLI",
    },
  ];
}

export function formatBrowseProbeHint(probe: StagehandBrowseProbe | null): string {
  if (!probe) return "正在检测 Stagehand 运行环境…";
  if (!probe.sidecarReady) {
    return probe.error
      ? `${probe.error}。可点击「安装 CLI」安装运行时、PATH 与会话 Skill。`
      : "Stagehand 运行时未安装，请先安装 CLI。";
  }
  if (!probe.cliAvailable) {
    return "运行时已就绪，正在写入 wise browse；若仍失败请点「安装 CLI」。";
  }
  const skill = probe.skillInstalled ? "Skill 已挂载" : "Skill 未挂载";
  return `会话输入框可直接说「打开谷歌官网」· ${skill}`;
}

export function collectStagehandEnvVars(input: {
  browserbaseApiKey?: string;
  modelApiKey?: string;
}): StagehandEnvVars {
  const env: StagehandEnvVars = {};
  const browserbaseApiKey = input.browserbaseApiKey?.trim();
  const modelApiKey = input.modelApiKey?.trim();
  if (browserbaseApiKey) env.BROWSERBASE_API_KEY = browserbaseApiKey;
  if (modelApiKey) {
    env.STAGEHAND_MODEL_API_KEY = modelApiKey;
    env.OPENAI_API_KEY = env.OPENAI_API_KEY ?? modelApiKey;
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY ?? modelApiKey;
  }
  return env;
}

export async function probeStagehandBrowse(): Promise<StagehandBrowseProbe> {
  return invoke<StagehandBrowseProbe>("stagehand_browse_probe");
}

export async function loadStagehandBrowseConfig(): Promise<StagehandStartOptions> {
  return invoke("stagehand_browse_load_config");
}

export async function saveStagehandBrowseConfig(
  config: StagehandStartOptions,
): Promise<StagehandStartOptions> {
  return invoke("stagehand_browse_save_config", { config });
}

export async function readStagehandDaemonStatus(): Promise<StagehandPageStatus & { cliAvailable?: boolean }> {
  const value = await invoke<unknown>("stagehand_browse_daemon_status");
  const page = parseStagehandPageStatus(value);
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...page,
    cliAvailable: obj.cliAvailable === true,
  };
}

export async function stopStagehandDaemon(): Promise<void> {
  await invoke("stagehand_browse_daemon_stop");
}

export async function installStagehandBrowseDeps(): Promise<StagehandBrowseExecResult> {
  return invoke<StagehandBrowseExecResult>("stagehand_browse_install_deps");
}

export async function startStagehandBrowse(input: {
  sessionId: string;
  options?: StagehandStartOptions;
  envVars?: StagehandEnvVars;
}): Promise<unknown> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new Error("sessionId 不能为空");
  return invoke("stagehand_browse_start", {
    sessionId,
    options: input.options ?? null,
    envVars: input.envVars ?? null,
  });
}

export async function stopStagehandBrowse(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;
  await invoke("stagehand_browse_stop", { sessionId: id });
}

export async function callStagehandBrowse(input: {
  sessionId: string;
  method: string;
  params?: Record<string, unknown>;
}): Promise<unknown> {
  const sessionId = input.sessionId.trim();
  const method = input.method.trim();
  if (!sessionId || !method) throw new Error("sessionId / method 不能为空");
  return invoke("stagehand_browse_call", {
    sessionId,
    method,
    params: input.params ?? null,
  });
}

export async function execStagehandBrowse(input: {
  sessionId: string;
  args: string[];
  envVars?: StagehandEnvVars;
  cwd?: string;
}): Promise<StagehandBrowseExecResult> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new Error("sessionId 不能为空");
  if (!input.args.length) throw new Error("browse 参数不能为空");
  return invoke<StagehandBrowseExecResult>("stagehand_browse_exec", {
    sessionId,
    args: input.args,
    envVars: input.envVars ?? null,
    cwd: input.cwd ?? null,
  });
}

export async function runStagehandCommand(input: {
  sessionId: string;
  spec: StagehandCommandSpec;
  values: StagehandFormValues;
  envVars?: StagehandEnvVars;
  cwd?: string;
}): Promise<{ engine: "sidecar" | "browse"; result: unknown }> {
  if (input.spec.engine === "browse") {
    const args = buildBrowseArgv(
      input.spec,
      input.values,
      sanitizeBrowseSessionName(input.sessionId),
    );
    const result = await execStagehandBrowse({
      sessionId: input.sessionId,
      args,
      envVars: input.envVars,
      cwd: input.cwd,
    });
    return { engine: "browse", result: unwrapBrowseExecResult(result) };
  }
  const params = buildSidecarParams(input.spec, input.values);
  const result = await callStagehandBrowse({
    sessionId: input.sessionId,
    method: input.spec.method,
    params,
  });
  return { engine: "sidecar", result };
}

export { STAGEHAND_COMMANDS };
