/**
 * Parse `wise browse` / `wise-browse` argv into a daemon RPC or browse passthrough.
 * @typedef {{ kind: "help" } | { kind: "daemon" } | { kind: "rpc"; method: string; params: Record<string, unknown>; needsSession: boolean } | { kind: "browse"; args: string[] } | { kind: "error"; error: string }} WiseBrowseParse
 */

const BROWSE_PASSTHROUGH = new Set([
  "doctor",
  "cdp",
  "env",
  "network",
  "cloud",
  "skills",
  "functions",
  "templates",
  "cursor",
]);

export const WISE_BROWSE_HELP = `Usage: wise browse <command> [args]
       wise-browse <command> [args]

在会话输入框用自然语言描述目标（例如「打开谷歌官网」），由助手调用本 CLI。
右上角浏览器自动化图标只负责环境 / 密钥 / 安装配置。

常用:
  open <url|站点名>
  act <instruction>
  extract <instruction> [--schema JSON]
  observe <instruction>
  snapshot
  screenshot [--full] [--path FILE]
  click <selector>
  fill <selector> <value> [--enter]
  get <field> [selector]
  status
  stop
  help

自然语言（会话输入框可直接转发）:
  wise browse 打开谷歌官网
  wise browse open 谷歌
  wise browse do "点击登录"

站点别名: 谷歌 / google / 百度 / 必应 / github / youtube / 知乎 / bilibili

智能:
  agent <instruction> [--max-steps N]

页面:
  reload | back | forward
  type <text> [--target SELECTOR]
  press <key>
  select <selector> <value>
  highlight <selector>
  eval <expression>
  viewport <width> <height>
  wait load [state]
  wait selector <selector>
  wait timeout <ms>
  tab list | tab new [url] | tab switch <index> | tab close [index]
  clipboard read | clipboard write <text>
  webmcp list | webmcp invoke <name> [--input JSON]
  mouse click <x> <y> | mouse hover <x> <y>
  mouse scroll <dx> <dy> | mouse drag <x1> <y1> <x2> <y2>

云端 / browse CLI（需安装 browse）:
  skills find <query>
  cloud fetch <url>
  doctor
`;

export const BROWSE_SITE_ALIASES = {
  google: "https://www.google.com",
  "google.com": "https://www.google.com",
  "www.google.com": "https://www.google.com",
  谷歌: "https://www.google.com",
  baidu: "https://www.baidu.com",
  "baidu.com": "https://www.baidu.com",
  百度: "https://www.baidu.com",
  bing: "https://www.bing.com",
  "bing.com": "https://www.bing.com",
  必应: "https://www.bing.com",
  github: "https://github.com",
  "github.com": "https://github.com",
  youtube: "https://www.youtube.com",
  "youtube.com": "https://www.youtube.com",
  哔哩哔哩: "https://www.bilibili.com",
  b站: "https://www.bilibili.com",
  bilibili: "https://www.bilibili.com",
  知乎: "https://www.zhihu.com",
  zhihu: "https://www.zhihu.com",
  淘宝: "https://www.taobao.com",
  taobao: "https://www.taobao.com",
  京东: "https://www.jd.com",
  jd: "https://www.jd.com",
};

function normalizeSiteKey(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/官网$/u, "");
}

/**
 * @param {string} input
 * @returns {string}
 */
export function resolveBrowseUrl(input) {
  const raw = String(input ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const opened = raw.match(/^(?:打开|访问|前往|open)\s*(.+)$/iu);
  if (opened) return resolveBrowseUrl(opened[1]);
  const key = normalizeSiteKey(raw);
  if (BROWSE_SITE_ALIASES[key]) return BROWSE_SITE_ALIASES[key];
  if (BROWSE_SITE_ALIASES[raw]) return BROWSE_SITE_ALIASES[raw];
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#].*)?$/i.test(raw)) {
    return `https://${raw}`;
  }
  return "";
}

function looksLikeNaturalLanguage(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (/[\u3400-\u9fff]/.test(value)) return true;
  return /^(打开|访问|前往|点击|点一下|填写|搜索|截图|抽取|提取|click|fill|search|screenshot|extract)\b/i.test(
    value,
  );
}

/**
 * @param {string} method
 * @param {unknown} result
 * @param {null | { url?: unknown; title?: unknown; running?: unknown }} page
 */
export function summarizeBrowseResult(method, result, page = null) {
  const url = typeof page?.url === "string" && page.url.trim() ? page.url.trim() : "";
  const title = typeof page?.title === "string" && page.title.trim() ? page.title.trim() : "";
  const pageLabel = title || url;
  switch (method) {
    case "open":
      return url ? `已打开 ${pageLabel}` : "已打开页面";
    case "act":
      return pageLabel ? `已操作页面：${pageLabel}` : "已执行页面操作";
    case "extract":
      return "已抽取页面内容";
    case "observe":
      return "已观察页面元素";
    case "screenshot": {
      const path =
        result && typeof result === "object" && typeof result.path === "string" ? result.path : "";
      return path ? `截图已保存 ${path}` : "已截图";
    }
    case "snapshot":
      return "已获取页面快照";
    case "start":
      return "浏览器已启动";
    case "stop":
      return result && typeof result === "object" && result.stopped === false
        ? "浏览器未在运行"
        : "已停止浏览器";
    case "status":
      if (page?.running === false || (result && typeof result === "object" && result.running === false)) {
        return "浏览器未启动";
      }
      return pageLabel ? `当前页 ${pageLabel}` : "浏览器运行中";
    default:
      return pageLabel ? `当前页 ${pageLabel}` : "";
  }
}

export function formatCliOutput(method, result, page = null) {
  const summary = summarizeBrowseResult(method, result, page);
  if (method === "status" || method === "ping" || method === "stop") {
    const base =
      result && typeof result === "object" && !Array.isArray(result) ? { ...result } : { result };
    return summary ? { summary, ...base } : base;
  }
  return {
    summary,
    url: typeof page?.url === "string" ? page.url : null,
    title: typeof page?.title === "string" ? page.title : null,
    data: result ?? null,
  };
}

/**
 * @param {string[]} argv
 * @returns {string[]}
 */
export function stripWiseBrowsePrefix(argv) {
  const args = argv.filter((part) => part !== "--json");
  if (args[0] === "browse" || args[0] === "browser") {
    return args.slice(1);
  }
  return args;
}

/**
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string | boolean>; rest: string[] }}
 */
export function splitFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (part.startsWith("--")) {
      const eq = part.indexOf("=");
      if (eq >= 0) {
        flags[part.slice(2, eq)] = part.slice(eq + 1);
        continue;
      }
      const key = part.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    rest.push(part);
  }
  return { flags, rest };
}

function asString(value) {
  if (typeof value === "string") return value;
  if (value == null || value === true) return "";
  return String(value);
}

function asNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`无效数字：${value}`);
  return n;
}

function asJson(value, label) {
  const text = asString(value).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

function joinInstruction(parts) {
  return parts.join(" ").trim();
}

function rpc(method, params, needsSession = true) {
  return { kind: "rpc", method, params, needsSession };
}

/**
 * @param {string[]} rawArgv process.argv.slice(2)
 * @returns {WiseBrowseParse}
 */
export function parseWiseBrowseArgv(rawArgv) {
  const argv = stripWiseBrowsePrefix(rawArgv ?? []);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h" || argv[0] === "--help") {
    return { kind: "help" };
  }
  if (argv[0] === "--daemon" || argv[0] === "daemon") {
    return { kind: "daemon" };
  }

  try {
    return parseCommand(argv);
  } catch (error) {
    return { kind: "error", error: String(error?.message ?? error) };
  }
}

/**
 * @param {string[]} argv
 * @returns {WiseBrowseParse}
 */
function parseCommand(argv) {
  const head = String(argv[0] ?? "");
  const dotted = head.includes(".") ? head : "";
  const cmd = dotted || head;
  const { flags, rest } = splitFlags(argv.slice(1));

  if (BROWSE_PASSTHROUGH.has(cmd)) {
    return { kind: "browse", args: [cmd, ...argv.slice(1)] };
  }

  switch (cmd) {
    case "ping":
      return rpc("ping", {}, false);
    case "start":
      return rpc(
        "start",
        {
          url: asString(flags.url || rest[0] || "") || undefined,
          env: asString(flags.env) || undefined,
          headed: flags.headless === true ? false : flags.headed !== false,
          model: asString(flags.model) || undefined,
          cdpUrl: asString(flags.cdp || flags["cdp-url"]) || undefined,
        },
        false,
      );
    case "stop":
      return rpc("stop", {}, false);
    case "status":
      return rpc("status", {}, false);
    case "metrics":
      return rpc("metrics", {});
    case "open":
    case "goto": {
      const url = resolveBrowseUrl(asString(flags.url || rest.join(" ")));
      if (!url) throw new Error("open 需要 URL 或站点名，例如 wise browse open 谷歌");
      return rpc("open", { url, waitUntil: asString(flags.waitUntil || flags["wait-until"]) || undefined });
    }
    case "do": {
      const instruction = joinInstruction(rest);
      if (!instruction) throw new Error("do 需要指令，例如 wise browse do \"点击登录\"");
      const url = resolveBrowseUrl(instruction);
      if (url) return rpc("open", { url });
      return rpc("act", { instruction });
    }
    case "reload":
      return rpc("reload", {});
    case "back":
      return rpc("back", {});
    case "forward":
      return rpc("forward", {});
    case "act": {
      const instruction = joinInstruction(rest);
      if (!instruction) throw new Error("act 需要指令，例如 wise browse act \"click Search\"");
      return rpc("act", { instruction });
    }
    case "extract": {
      const instruction = joinInstruction(rest);
      if (!instruction) throw new Error("extract 需要指令");
      return rpc("extract", { instruction, schema: asJson(flags.schema, "--schema") });
    }
    case "observe": {
      const instruction = joinInstruction(rest);
      if (!instruction) throw new Error("observe 需要指令");
      return rpc("observe", { instruction });
    }
    case "agent": {
      const instruction = joinInstruction(rest);
      if (!instruction) throw new Error("agent 需要指令");
      const maxSteps = flags["max-steps"] ?? flags.maxSteps;
      return rpc("agent", {
        instruction,
        maxSteps: maxSteps == null || maxSteps === true ? undefined : asNumber(maxSteps),
      });
    }
    case "snapshot":
      return rpc("snapshot", { filter: asString(flags.filter) || undefined });
    case "screenshot":
      return rpc("screenshot", {
        fullPage: flags.full === true || flags.fullPage === true || flags["full-page"] === true,
        path: asString(flags.path) || undefined,
      });
    case "click": {
      const target = rest[0];
      if (!target) throw new Error("click 需要选择器");
      return rpc("click", { target });
    }
    case "fill": {
      const target = rest[0];
      const value = rest.slice(1).join(" ");
      if (!target) throw new Error("fill 需要选择器和值");
      return rpc("fill", { target, value, pressEnter: flags.enter === true });
    }
    case "select": {
      if (!rest[0] || rest[1] == null) throw new Error("select 需要选择器和值");
      return rpc("select", { target: rest[0], value: rest.slice(1).join(" ") });
    }
    case "type":
      return rpc("type", {
        text: joinInstruction(rest),
        target: asString(flags.target) || undefined,
      });
    case "press":
    case "key":
      return rpc("press", { key: rest[0] || "Enter" });
    case "upload":
      return rpc("upload", { target: rest[0], file: rest[1] || asString(flags.file) });
    case "highlight":
      return rpc("highlight", { target: rest[0], duration: flags.duration ? asNumber(flags.duration) : undefined });
    case "get":
      return rpc("get", { field: rest[0] || "title", target: rest[1] || undefined });
    case "is":
      return rpc("is", { state: rest[0] || "visible", target: rest[1] });
    case "eval":
    case "evaluate":
      return rpc("evaluate", { expression: joinInstruction(rest) });
    case "run":
    case "runCode":
      return rpc("runCode", { code: joinInstruction(rest) });
    case "viewport":
      return rpc("viewport", { width: asNumber(rest[0] ?? flags.width), height: asNumber(rest[1] ?? flags.height) });
    case "mouse":
      return parseMouse(rest, flags);
    case "wait":
      return parseWait(rest, flags);
    case "tab":
      return parseTab(rest);
    case "clipboard":
      return parseClipboard(rest);
    case "webmcp":
      return parseWebmcp(rest, flags);
    default:
      if (cmd === "mouse.click" || cmd === "mouse.hover" || cmd === "mouse.scroll" || cmd === "mouse.drag") {
        return parseMouse([cmd.slice("mouse.".length), ...rest], flags);
      }
      if (cmd === "wait.load" || cmd === "wait.selector" || cmd === "wait.timeout") {
        return parseWait([cmd.slice("wait.".length), ...rest], flags);
      }
      if (cmd.startsWith("tab.")) {
        return parseTab([cmd.slice("tab.".length), ...rest]);
      }
      if (cmd === "clipboard.read" || cmd === "clipboard.write") {
        return parseClipboard([cmd.slice("clipboard.".length), ...rest]);
      }
      if (cmd === "webmcp.list" || cmd === "webmcp.invoke") {
        return parseWebmcp([cmd.slice("webmcp.".length), ...rest], flags);
      }
      return parseImplicitCommand(argv);
  }
}

function parseImplicitCommand(argv) {
  const joined = argv.join(" ").trim();
  const url = resolveBrowseUrl(joined);
  if (url) return rpc("open", { url });
  if (looksLikeNaturalLanguage(joined)) {
    return rpc("act", { instruction: joined });
  }
  throw new Error(`未知命令：${argv[0] ?? ""}。运行 wise browse help 查看用法。`);
}

function parseMouse(rest, flags) {
  const sub = rest[0];
  const nums = rest.slice(1);
  if (sub === "click") {
    return rpc("mouseClick", {
      x: asNumber(nums[0] ?? flags.x),
      y: asNumber(nums[1] ?? flags.y),
      button: asString(flags.button) || undefined,
    });
  }
  if (sub === "hover") {
    return rpc("mouseHover", { x: asNumber(nums[0]), y: asNumber(nums[1]) });
  }
  if (sub === "scroll") {
    return rpc("mouseScroll", {
      dx: asNumber(nums[0] ?? flags.dx),
      dy: asNumber(nums[1] ?? flags.dy),
    });
  }
  if (sub === "drag") {
    return rpc("mouseDrag", {
      x1: asNumber(nums[0]),
      y1: asNumber(nums[1]),
      x2: asNumber(nums[2]),
      y2: asNumber(nums[3]),
    });
  }
  throw new Error("mouse 子命令：click | hover | scroll | drag");
}

function parseWait(rest, flags) {
  const sub = rest[0];
  if (!sub || sub === "load") {
    return rpc("waitLoad", { state: rest[1] || asString(flags.state) || "load", timeout: flags.timeout ? asNumber(flags.timeout) : undefined });
  }
  if (sub === "selector") {
    if (!rest[1]) throw new Error("wait selector 需要选择器");
    return rpc("waitSelector", {
      target: rest[1],
      state: rest[2] || asString(flags.state) || undefined,
      timeout: flags.timeout ? asNumber(flags.timeout) : undefined,
    });
  }
  if (sub === "timeout") {
    return rpc("waitTimeout", { ms: asNumber(rest[1] ?? flags.ms) });
  }
  throw new Error("wait 子命令：load | selector | timeout");
}

function parseTab(rest) {
  const sub = rest[0];
  if (!sub || sub === "list") return rpc("tabList", {});
  if (sub === "new") return rpc("tabNew", { url: rest[1] || undefined });
  if (sub === "switch") return rpc("tabSwitch", { targetId: rest[1] });
  if (sub === "close") return rpc("tabClose", { targetId: rest[1] || undefined });
  throw new Error("tab 子命令：list | new | switch | close");
}

function parseClipboard(rest) {
  const sub = rest[0];
  if (!sub || sub === "read") return rpc("clipboardRead", {});
  if (sub === "write") return rpc("clipboardWrite", { text: rest.slice(1).join(" ") });
  throw new Error("clipboard 子命令：read | write");
}

function parseWebmcp(rest, flags) {
  const sub = rest[0];
  if (!sub || sub === "list" || sub === "tools") return rpc("webmcpTools", {});
  if (sub === "invoke") {
    return rpc("webmcpInvoke", {
      name: rest[1],
      input: asJson(flags.input || rest.slice(2).join(" "), "--input") ?? {},
    });
  }
  throw new Error("webmcp 子命令：list | invoke");
}
