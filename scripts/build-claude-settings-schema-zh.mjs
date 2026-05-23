/**
 * 将 claude-code-settings.schema.en.json 的 description 本地化为中文，
 * 来源：官方 zh-CN 文档表格 + 短语回退。
 *
 * 运行：bun scripts/build-claude-settings-schema-zh.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src/data");

const SETTINGS_DOC = join(dataDir, "claude-settings-doc-zh-CN.md");
const ENV_DOC = join(dataDir, "claude-env-vars-doc-zh-CN.md");
const SCHEMA_EN = join(dataDir, "claude-code-settings.schema.en.json");
const SCHEMA_OUT = join(dataDir, "claude-code-settings.schema.json");

/** 文档插件节未列入「可用设置」表的键 */
const PLUGIN_ZH = {
  enabledPlugins:
    "控制启用哪些插件。格式：\"plugin-name@marketplace-name\": true/false。用户/项目/本地/Managed 作用域规则见官方文档。",
  extraKnownMarketplaces:
    "定义应为存储库提供的额外插件市场（github、git、directory、hostPattern、settings 等源类型）。",
};

const ROOT_ZH =
  "Claude Code 的 settings.json 配置项。详见 https://code.claude.com/docs/zh-CN/settings";

const NESTED_ZH = {
  "attribution.commit":
    "Git 提交的归属文案（含 trailer）。空字符串可隐藏提交归属。",
  "attribution.pr": "拉取请求描述的归属文案。空字符串可隐藏 PR 归属。",
  "$schema": "Claude Code settings.json 的 JSON Schema 引用。",
};

const PERMISSION_KEYS = new Set([
  "allow",
  "ask",
  "deny",
  "additionalDirectories",
  "defaultMode",
  "disableBypassPermissionsMode",
  "skipDangerousModePermissionPrompt",
]);

const SANDBOX_TOP_KEYS = new Set([
  "enabled",
  "failIfUnavailable",
  "autoAllowBashIfSandboxed",
  "excludedCommands",
  "allowUnsandboxedCommands",
  "enableWeakerNestedSandbox",
  "enableWeakerNetworkIsolation",
  "bwrapPath",
  "socatPath",
]);

const PHRASE_RULES = [
  [/^\(Managed settings only\)\s*/i, "（仅 Managed 设置）"],
  [/^\(Managed setting only\)\s*/i, "（仅 Managed 设置）"],
  [/JSON Schema reference for Claude Code settings/i, NESTED_ZH["$schema"]],
  [/Tool permission rule/i, "工具权限规则"],
  [/Bash command hook/i, "Bash 命令 Hook"],
  [/LLM prompt hook/i, "LLM 提示 Hook"],
  [/Agent hook with multi-turn tool access/i, "多轮工具访问的 Agent Hook"],
  [/Hook type/i, "Hook 类型"],
  [/Shell command to execute/i, "要执行的 Shell 命令"],
  [/Optional timeout in seconds/i, "可选超时（秒）"],
  [/List of permission rules for allowed operations/i, "允许的工具权限规则列表"],
  [/List of permission rules for denied operations/i, "拒绝的工具权限规则列表"],
  [/List of permission rules that should always prompt/i, "需要确认的工具权限规则列表"],
  [/Disable the ability to bypass permission prompts/i, "禁用绕过权限提示"],
  [/Additional directories to include in the permission scope/i, "权限范围内的额外目录"],
  [/Default:/i, "默认："],
  [/See https:\/\/code\.claude\.com\/docs\/en\//gi, "详见 https://code.claude.com/docs/zh-CN/"],
  [/See https:\/\/code\.claude\.com\/docs\//gi, "详见 https://code.claude.com/docs/zh-CN/"],
  [/Run this hook asynchronously without blocking Claude Code/i, "异步运行 Hook，不阻塞 Claude Code"],
  [
    /When true, the hook runs in the background and wakes the model when it exits with code 2/i,
    "为 true 时 Hook 在后台运行，退出码为 2 时唤醒模型",
  ],
  [
    /Shell interpreter for the command/i,
    "命令的 Shell 解释器；bash 使用登录 shell，powershell 使用 pwsh",
  ],
  [/Custom spinner message displayed while the hook runs/i, "Hook 运行期间显示的自定义微调器消息"],
  [
    /Prompt to evaluate with LLM/i,
    "供 LLM 评估的提示；可使用 $ARGUMENTS 占位符传入 Hook 输入 JSON",
  ],
  [
    /Prompt describing what to verify/i,
    "描述验证内容的提示；可使用 $ARGUMENTS 占位符传入 Hook 输入 JSON",
  ],
  [/URL to POST hook input JSON to/i, "接收 Hook 输入 JSON 的 POST URL，端点须返回 JSON"],
  [/Custom HTTP headers/i, "自定义 HTTP 标头；值支持 $VAR_NAME 或 ${VAR_NAME} 环境变量插值"],
  [
    /List of environment variable names permitted for interpolation in headers/i,
    "允许在标头中插值的环境变量名列表",
  ],
  [/Name of a configured MCP server/i, "已配置的 MCP 服务器名称（须已连接）"],
  [/Name of the tool to call on that server/i, "在该服务器上调用的工具名称"],
  [
    /Arguments passed to the tool/i,
    "传给工具的参数；字符串支持从 Hook JSON 进行 ${path} 替换",
  ],
  [/Time budget in milliseconds for SessionEnd hooks/i, "SessionEnd Hook 的时间预算（毫秒）"],
  [/Project root directory path/i, "项目根目录路径（也会传给 hooks）"],
  [/Path to custom CA certificate file/i, "自定义 CA 证书文件路径"],
  [/OpenTelemetry metrics exporter configuration/i, "OpenTelemetry 指标导出器配置"],
  [/Name of the MCP server that users are allowed to configure/i, "允许用户配置的 MCP 服务器名称"],
  [/Exact command and arguments used to start stdio servers/i, "启动 stdio MCP 服务器的命令及参数"],
  [/URL pattern for remote servers/i, "远程服务器 URL 模式，支持通配符"],
  [/Name of the MCP server that is explicitly blocked/i, "被明确阻止的 MCP 服务器名称"],
  [/Hooks that run before tool calls/i, "工具调用前运行的 Hooks"],
  [/Hooks that run after tool completion/i, "工具完成后运行的 Hooks"],
  [/Hooks that run after a tool fails/i, "工具失败后运行的 Hooks"],
  [/Hooks that run when a permission dialog appears/i, "权限对话框出现时运行的 Hooks"],
  [/Hooks that trigger on notifications/i, "通知触发时运行的 Hooks"],
  [/Model to use for evaluation/i, "用于评估的模型，默认使用快速模型"],
  [/Identifies the marketplace source type/i, "市场源类型标识"],
  [/Direct URL to marketplace\.json file/i, "marketplace.json 的直接 URL"],
  [/Git host pattern to trust/i, "信任的 Git 主机匹配模式"],
];

function stripMdCell(text) {
  return text
    .replace(/\{\/\*[^*]*\*\/\}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMdTable(md, keyColumn = 0, descColumn = 1) {
  const map = new Map();
  for (const line of md.split("\n")) {
    if (!line.startsWith("|") || line.includes("---")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const rawKey = cells[keyColumn];
    const keyMatch = rawKey.match(/^`([^`]+)`$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const desc = stripMdCell(cells[descColumn] ?? "");
    if (desc) map.set(key, desc);
  }
  return map;
}

function translateFallback(en) {
  if (!en || /[\u4e00-\u9fff]/.test(en)) return en;
  let t = en;
  for (const [re, rep] of PHRASE_RULES) {
    t = t.replace(re, rep);
  }
  return t;
}

function classifyTableRow(key, desc, maps) {
  if (key.startsWith("worktree.")) {
    maps.worktree.set(key.slice("worktree.".length), desc);
    return;
  }
  if (key.startsWith("filesystem.") || key.startsWith("network.")) {
    maps.sandbox.set(key, desc);
    return;
  }
  if (SANDBOX_TOP_KEYS.has(key)) {
    maps.sandbox.set(key, desc);
    return;
  }
  if (PERMISSION_KEYS.has(key)) {
    maps.permissions.set(key, desc);
    return;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
    maps.env.set(key, desc);
    return;
  }
  maps.top.set(key, desc);
}

function buildMapsFromDocs(settingsMd, envMd) {
  const maps = {
    top: new Map(),
    env: new Map(),
    permissions: new Map(),
    sandbox: new Map(),
    worktree: new Map(),
    nested: new Map(Object.entries(NESTED_ZH)),
  };

  for (const [key, desc] of parseMdTable(settingsMd)) {
    classifyTableRow(key, desc, maps);
  }
  for (const [key, desc] of parseMdTable(envMd)) {
    maps.env.set(key, desc);
  }

  return maps;
}

function lookupDescription(pathParts, maps) {
  if (pathParts.length === 0) return ROOT_ZH;

  const dotted = pathParts.join(".");
  if (maps.nested.has(dotted)) return maps.nested.get(dotted);

  if (pathParts.length === 1) {
    return maps.top.get(pathParts[0]) ?? PLUGIN_ZH[pathParts[0]] ?? null;
  }

  if (pathParts[0] === "env" && pathParts.length === 2) {
    return maps.env.get(pathParts[1]) ?? null;
  }

  if (pathParts[0] === "permissions" && pathParts.length === 2) {
    return maps.permissions.get(pathParts[1]) ?? null;
  }

  if (pathParts[0] === "sandbox") {
    const dottedKey = pathParts.slice(1).join(".");
    return maps.sandbox.get(dottedKey) ?? null;
  }

  if (pathParts[0] === "worktree" && pathParts.length === 2) {
    return maps.worktree.get(pathParts[1]) ?? null;
  }

  return null;
}

function walkProperties(node, pathParts, maps, stats) {
  if (!node || typeof node !== "object") return;

  if (typeof node.description === "string") {
    const zh = lookupDescription(pathParts, maps);
    if (zh) {
      node.description = zh;
      stats.matched += 1;
    } else {
      const fallback = translateFallback(node.description);
      node.description = fallback;
      if (fallback !== node.description || /[\u4e00-\u9fff]/.test(fallback)) {
        stats.fallback += 1;
      } else if (/^[A-Za-z]/.test(node.description)) {
        stats.englishLeft += 1;
      }
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [key, child] of Object.entries(node.properties)) {
      walkProperties(child, [...pathParts, key], maps, stats);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "description") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") walkProperties(item, pathParts, maps, stats);
      }
    } else if (value && typeof value === "object") {
      walkProperties(value, pathParts, maps, stats);
    }
  }
}

function main() {
  const settingsMd = readFileSync(SETTINGS_DOC, "utf8");
  const envMd = readFileSync(ENV_DOC, "utf8");
  const schema = JSON.parse(readFileSync(SCHEMA_EN, "utf8"));

  const maps = buildMapsFromDocs(settingsMd, envMd);

  const stats = { matched: 0, fallback: 0, englishLeft: 0 };

  if (typeof schema.description === "string") {
    schema.description = ROOT_ZH;
  }

  walkProperties(schema, [], maps, stats);

  writeFileSync(SCHEMA_OUT, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${SCHEMA_OUT}\n` +
      `  top-level keys: ${maps.top.size}\n` +
      `  env keys: ${maps.env.size}\n` +
      `  permissions: ${maps.permissions.size}\n` +
      `  sandbox: ${maps.sandbox.size}\n` +
      `  descriptions localized (exact): ${stats.matched}\n` +
      `  descriptions phrase-fallback: ${stats.fallback}`,
  );
}

main();
