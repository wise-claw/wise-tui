export type StagehandEngine = "sidecar" | "browse";

export type StagehandArgKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "json"
  | "file"
  | "password";

export type StagehandArgSpec = {
  name: string;
  label: string;
  kind: StagehandArgKind;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
};

export type StagehandCommandGroupId =
  | "session"
  | "navigate"
  | "ai"
  | "element"
  | "mouse"
  | "page"
  | "wait"
  | "tabs"
  | "clipboard"
  | "webmcp"
  | "network"
  | "cloud"
  | "skills"
  | "functions"
  | "templates";

export type StagehandCommandSpec = {
  id: string;
  group: StagehandCommandGroupId;
  groupLabel: string;
  label: string;
  description: string;
  engine: StagehandEngine;
  method: string;
  browseArgs?: string[];
  args: StagehandArgSpec[];
  needsSession?: boolean;
};

export const STAGEHAND_COMMAND_GROUPS: Array<{
  id: StagehandCommandGroupId;
  label: string;
}> = [
  { id: "session", label: "会话" },
  { id: "navigate", label: "导航" },
  { id: "ai", label: "智能" },
  { id: "element", label: "元素" },
  { id: "mouse", label: "鼠标" },
  { id: "page", label: "页面" },
  { id: "wait", label: "等待" },
  { id: "tabs", label: "标签" },
  { id: "clipboard", label: "剪贴板" },
  { id: "webmcp", label: "WebMCP" },
  { id: "network", label: "网络" },
  { id: "cloud", label: "云端" },
  { id: "skills", label: "Skills" },
  { id: "functions", label: "Functions" },
  { id: "templates", label: "模板" },
];

export type StagehandSurfaceId = "ai" | "action" | "page" | "cloud";

export const STAGEHAND_SURFACES: Array<{
  id: StagehandSurfaceId;
  label: string;
  hint: string;
  groups: StagehandCommandGroupId[];
}> = [
  { id: "ai", label: "智能", hint: "自然语言操作、抽取与观察", groups: ["ai"] },
  {
    id: "action",
    label: "操作",
    hint: "导航、点击、填写、鼠标与等待",
    groups: ["navigate", "element", "mouse", "wait"],
  },
  {
    id: "page",
    label: "页面",
    hint: "读取、截图、标签、剪贴板、WebMCP",
    groups: ["page", "tabs", "clipboard", "webmcp"],
  },
  {
    id: "cloud",
    label: "云端",
    hint: "browse CLI：诊断、网络、Cloud、Skills、Functions",
    groups: ["session", "network", "cloud", "skills", "functions", "templates"],
  },
];

export const STAGEHAND_QUICK_COMMAND_IDS = ["open", "snapshot", "screenshot", "status"] as const;

const TARGET_ARG: StagehandArgSpec = {
  name: "target",
  label: "目标",
  kind: "string",
  required: true,
  placeholder: "@0-12 / CSS / XPath",
  hint: "快照 ref、CSS 选择器或 XPath",
};

function cmd(
  spec: Omit<StagehandCommandSpec, "groupLabel"> & { group: StagehandCommandGroupId },
): StagehandCommandSpec {
  const groupLabel =
    STAGEHAND_COMMAND_GROUPS.find((group) => group.id === spec.group)?.label ?? spec.group;
  return { ...spec, groupLabel, needsSession: spec.needsSession ?? spec.engine === "sidecar" };
}

export const STAGEHAND_COMMANDS: StagehandCommandSpec[] = [
  cmd({
    id: "status",
    group: "session",
    label: "状态",
    description: "查看当前浏览器会话状态",
    engine: "sidecar",
    method: "status",
    args: [],
  }),
  cmd({
    id: "metrics",
    group: "session",
    label: "指标",
    description: "读取 Stagehand 推理耗时与 token 用量",
    engine: "sidecar",
    method: "metrics",
    args: [],
  }),
  cmd({
    id: "doctor",
    group: "session",
    label: "诊断",
    description: "检查 browse CLI 与浏览器连接前提",
    engine: "browse",
    method: "doctor",
    browseArgs: ["doctor"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "env",
    group: "session",
    label: "环境",
    description: "查看或切换 browse 的 local / remote 环境",
    engine: "browse",
    method: "env",
    browseArgs: ["env"],
    args: [
      {
        name: "target",
        label: "目标环境",
        kind: "select",
        options: [
          { value: "", label: "查看当前" },
          { value: "local", label: "local" },
          { value: "remote", label: "remote" },
        ],
      },
    ],
    needsSession: false,
  }),
  cmd({
    id: "open",
    group: "navigate",
    label: "打开 URL",
    description: "导航到指定地址",
    engine: "sidecar",
    method: "open",
    browseArgs: ["open"],
    args: [
      { name: "url", label: "URL", kind: "string", required: true, placeholder: "https://example.com" },
      {
        name: "waitUntil",
        label: "等待",
        kind: "select",
        options: [
          { value: "load", label: "load" },
          { value: "domcontentloaded", label: "domcontentloaded" },
          { value: "networkidle", label: "networkidle" },
        ],
      },
    ],
  }),
  cmd({
    id: "reload",
    group: "navigate",
    label: "刷新",
    description: "刷新当前页",
    engine: "sidecar",
    method: "reload",
    browseArgs: ["reload"],
    args: [],
  }),
  cmd({
    id: "back",
    group: "navigate",
    label: "后退",
    description: "历史后退",
    engine: "sidecar",
    method: "back",
    browseArgs: ["back"],
    args: [],
  }),
  cmd({
    id: "forward",
    group: "navigate",
    label: "前进",
    description: "历史前进",
    engine: "sidecar",
    method: "forward",
    browseArgs: ["forward"],
    args: [],
  }),
  cmd({
    id: "act",
    group: "ai",
    label: "Act",
    description: "用自然语言执行单步操作（点击、填写、滚动等）",
    engine: "sidecar",
    method: "act",
    args: [
      {
        name: "instruction",
        label: "指令",
        kind: "text",
        required: true,
        placeholder: "click the login button",
      },
    ],
  }),
  cmd({
    id: "extract",
    group: "ai",
    label: "Extract",
    description: "按自然语言或 JSON Schema 抽取结构化数据",
    engine: "sidecar",
    method: "extract",
    args: [
      {
        name: "instruction",
        label: "指令",
        kind: "text",
        required: true,
        placeholder: "extract the page title and price",
      },
      {
        name: "schema",
        label: "JSON Schema",
        kind: "json",
        placeholder: '{ "type": "object", "properties": { "title": { "type": "string" } } }',
      },
    ],
  }),
  cmd({
    id: "observe",
    group: "ai",
    label: "Observe",
    description: "发现页面可执行动作，可再交给 Act",
    engine: "sidecar",
    method: "observe",
    args: [
      {
        name: "instruction",
        label: "指令",
        kind: "text",
        required: true,
        placeholder: "find submit buttons",
      },
    ],
  }),
  cmd({
    id: "agent",
    group: "ai",
    label: "Agent",
    description: "多步自主执行（Stagehand v3 agent / v4 请拆成 Act+Observe）",
    engine: "sidecar",
    method: "agent",
    args: [
      {
        name: "instruction",
        label: "任务",
        kind: "text",
        required: true,
        placeholder: "Search for NVDA stock price and extract it",
      },
      { name: "maxSteps", label: "最大步数", kind: "number", placeholder: "20" },
    ],
  }),
  cmd({
    id: "snapshot",
    group: "ai",
    label: "Snapshot",
    description: "可访问性树 / 可交互元素快照，生成 @ref",
    engine: "sidecar",
    method: "snapshot",
    browseArgs: ["snapshot"],
    args: [
      { name: "full", label: "完整映射", kind: "boolean" },
      { name: "filter", label: "过滤", kind: "string", placeholder: "submit 或 /regex/" },
      { name: "maxDepth", label: "最大深度", kind: "number" },
    ],
  }),
  cmd({
    id: "click",
    group: "element",
    label: "点击",
    description: "点击目标元素",
    engine: "sidecar",
    method: "click",
    browseArgs: ["click"],
    args: [TARGET_ARG],
  }),
  cmd({
    id: "fill",
    group: "element",
    label: "填写",
    description: "填充输入框",
    engine: "sidecar",
    method: "fill",
    browseArgs: ["fill"],
    args: [
      TARGET_ARG,
      { name: "value", label: "内容", kind: "string", required: true },
      { name: "pressEnter", label: "提交回车", kind: "boolean" },
    ],
  }),
  cmd({
    id: "select",
    group: "element",
    label: "选择",
    description: "选择下拉项",
    engine: "sidecar",
    method: "select",
    browseArgs: ["select"],
    args: [TARGET_ARG, { name: "value", label: "选项", kind: "string", required: true }],
  }),
  cmd({
    id: "type",
    group: "element",
    label: "键入",
    description: "在当前焦点键入文本",
    engine: "sidecar",
    method: "type",
    browseArgs: ["type"],
    args: [
      { name: "text", label: "文本", kind: "string", required: true },
      { name: "delay", label: "延迟 ms", kind: "number" },
    ],
  }),
  cmd({
    id: "press",
    group: "element",
    label: "按键",
    description: "发送键盘按键，如 Enter、Meta+K",
    engine: "sidecar",
    method: "press",
    browseArgs: ["press"],
    args: [{ name: "key", label: "按键", kind: "string", required: true, placeholder: "Enter" }],
  }),
  cmd({
    id: "upload",
    group: "element",
    label: "上传",
    description: "向文件输入上传本地文件",
    engine: "sidecar",
    method: "upload",
    browseArgs: ["upload"],
    args: [TARGET_ARG, { name: "file", label: "文件路径", kind: "file", required: true }],
  }),
  cmd({
    id: "highlight",
    group: "element",
    label: "高亮",
    description: "高亮目标元素",
    engine: "sidecar",
    method: "highlight",
    browseArgs: ["highlight"],
    args: [TARGET_ARG, { name: "duration", label: "时长 ms", kind: "number" }],
  }),
  cmd({
    id: "mouse.click",
    group: "mouse",
    label: "坐标点击",
    description: "按像素坐标点击",
    engine: "sidecar",
    method: "mouseClick",
    browseArgs: ["mouse", "click"],
    args: [
      { name: "x", label: "X", kind: "number", required: true },
      { name: "y", label: "Y", kind: "number", required: true },
      {
        name: "button",
        label: "按钮",
        kind: "select",
        options: [
          { value: "left", label: "左键" },
          { value: "right", label: "右键" },
          { value: "middle", label: "中键" },
        ],
      },
    ],
  }),
  cmd({
    id: "mouse.hover",
    group: "mouse",
    label: "移动",
    description: "移动鼠标到坐标",
    engine: "sidecar",
    method: "mouseHover",
    browseArgs: ["mouse", "hover"],
    args: [
      { name: "x", label: "X", kind: "number", required: true },
      { name: "y", label: "Y", kind: "number", required: true },
    ],
  }),
  cmd({
    id: "mouse.scroll",
    group: "mouse",
    label: "滚动",
    description: "从坐标滚动 (dx, dy)",
    engine: "sidecar",
    method: "mouseScroll",
    browseArgs: ["mouse", "scroll"],
    args: [
      { name: "x", label: "X", kind: "number", required: true },
      { name: "y", label: "Y", kind: "number", required: true },
      { name: "dx", label: "dx", kind: "number", required: true },
      { name: "dy", label: "dy", kind: "number", required: true },
    ],
  }),
  cmd({
    id: "mouse.drag",
    group: "mouse",
    label: "拖拽",
    description: "在两点之间拖拽",
    engine: "sidecar",
    method: "mouseDrag",
    browseArgs: ["mouse", "drag"],
    args: [
      { name: "x1", label: "起点 X", kind: "number", required: true },
      { name: "y1", label: "起点 Y", kind: "number", required: true },
      { name: "x2", label: "终点 X", kind: "number", required: true },
      { name: "y2", label: "终点 Y", kind: "number", required: true },
    ],
  }),
  cmd({
    id: "get",
    group: "page",
    label: "读取",
    description: "读取页面或元素状态",
    engine: "sidecar",
    method: "get",
    browseArgs: ["get"],
    args: [
      {
        name: "field",
        label: "字段",
        kind: "select",
        required: true,
        options: [
          { value: "url", label: "url" },
          { value: "title", label: "title" },
          { value: "text", label: "text" },
          { value: "html", label: "html" },
          { value: "value", label: "value" },
          { value: "box", label: "box" },
          { value: "markdown", label: "markdown" },
        ],
      },
      { name: "target", label: "目标", kind: "string", placeholder: "可选，元素选择器" },
    ],
  }),
  cmd({
    id: "is",
    group: "page",
    label: "判断",
    description: "检查元素 visible / checked",
    engine: "sidecar",
    method: "is",
    browseArgs: ["is"],
    args: [
      {
        name: "state",
        label: "状态",
        kind: "select",
        required: true,
        options: [
          { value: "visible", label: "visible" },
          { value: "checked", label: "checked" },
        ],
      },
      TARGET_ARG,
    ],
  }),
  cmd({
    id: "eval",
    group: "page",
    label: "执行脚本",
    description: "在页面上下文执行 JavaScript",
    engine: "sidecar",
    method: "evaluate",
    browseArgs: ["eval"],
    args: [
      {
        name: "expression",
        label: "表达式",
        kind: "text",
        required: true,
        placeholder: "document.title",
      },
    ],
  }),
  cmd({
    id: "runCode",
    group: "page",
    label: "Run（page/context）",
    description: "在 Stagehand 侧执行针对 page/context/browser 的脚本",
    engine: "sidecar",
    method: "runCode",
    args: [
      {
        name: "code",
        label: "代码",
        kind: "text",
        required: true,
        placeholder: "await page.goto('https://example.com'); return await page.title();",
      },
    ],
  }),
  cmd({
    id: "viewport",
    group: "page",
    label: "视口",
    description: "设置视口尺寸",
    engine: "sidecar",
    method: "viewport",
    browseArgs: ["viewport"],
    args: [
      { name: "width", label: "宽", kind: "number", required: true, placeholder: "1280" },
      { name: "height", label: "高", kind: "number", required: true, placeholder: "720" },
    ],
  }),
  cmd({
    id: "screenshot",
    group: "page",
    label: "截图",
    description: "捕获当前页截图",
    engine: "sidecar",
    method: "screenshot",
    browseArgs: ["screenshot"],
    args: [
      { name: "fullPage", label: "整页", kind: "boolean" },
      { name: "path", label: "保存路径", kind: "file" },
    ],
  }),
  cmd({
    id: "cursor",
    group: "page",
    label: "光标",
    description: "显示可见光标叠加（browse CLI）",
    engine: "browse",
    method: "cursor",
    browseArgs: ["cursor"],
    args: [],
  }),
  cmd({
    id: "wait.load",
    group: "wait",
    label: "等待加载",
    description: "等待页面加载状态",
    engine: "sidecar",
    method: "waitLoad",
    browseArgs: ["wait", "load"],
    args: [
      {
        name: "state",
        label: "状态",
        kind: "select",
        options: [
          { value: "load", label: "load" },
          { value: "domcontentloaded", label: "domcontentloaded" },
          { value: "networkidle", label: "networkidle" },
        ],
      },
      { name: "timeout", label: "超时 ms", kind: "number" },
    ],
  }),
  cmd({
    id: "wait.selector",
    group: "wait",
    label: "等待选择器",
    description: "等待元素到达指定状态",
    engine: "sidecar",
    method: "waitSelector",
    browseArgs: ["wait", "selector"],
    args: [
      TARGET_ARG,
      {
        name: "state",
        label: "状态",
        kind: "select",
        options: [
          { value: "visible", label: "visible" },
          { value: "hidden", label: "hidden" },
          { value: "attached", label: "attached" },
          { value: "detached", label: "detached" },
        ],
      },
      { name: "timeout", label: "超时 ms", kind: "number" },
    ],
  }),
  cmd({
    id: "wait.timeout",
    group: "wait",
    label: "等待时长",
    description: "固定等待毫秒",
    engine: "sidecar",
    method: "waitTimeout",
    browseArgs: ["wait", "timeout"],
    args: [{ name: "ms", label: "毫秒", kind: "number", required: true, placeholder: "1000" }],
  }),
  cmd({
    id: "tab.list",
    group: "tabs",
    label: "列出标签",
    description: "列出当前上下文中的页面",
    engine: "sidecar",
    method: "tabList",
    browseArgs: ["tab", "list"],
    args: [],
  }),
  cmd({
    id: "tab.new",
    group: "tabs",
    label: "新建标签",
    description: "打开新标签并激活",
    engine: "sidecar",
    method: "tabNew",
    browseArgs: ["tab", "new"],
    args: [{ name: "url", label: "URL", kind: "string", placeholder: "https://example.com" }],
  }),
  cmd({
    id: "tab.switch",
    group: "tabs",
    label: "切换标签",
    description: "按索引或 targetId 切换",
    engine: "sidecar",
    method: "tabSwitch",
    browseArgs: ["tab", "switch"],
    args: [{ name: "targetId", label: "索引 / targetId", kind: "string", required: true }],
  }),
  cmd({
    id: "tab.close",
    group: "tabs",
    label: "关闭标签",
    description: "关闭指定或当前标签",
    engine: "sidecar",
    method: "tabClose",
    browseArgs: ["tab", "close"],
    args: [{ name: "targetId", label: "索引 / targetId", kind: "string" }],
  }),
  cmd({
    id: "clipboard.read",
    group: "clipboard",
    label: "读取剪贴板",
    description: "读取浏览器剪贴板",
    engine: "sidecar",
    method: "clipboardRead",
    args: [],
  }),
  cmd({
    id: "clipboard.write",
    group: "clipboard",
    label: "写入剪贴板",
    description: "写入浏览器剪贴板",
    engine: "sidecar",
    method: "clipboardWrite",
    args: [{ name: "text", label: "文本", kind: "text", required: true }],
  }),
  cmd({
    id: "webmcp.list",
    group: "webmcp",
    label: "列出工具",
    description: "发现当前页注册的 WebMCP 工具",
    engine: "sidecar",
    method: "webmcpTools",
    args: [{ name: "timeout", label: "超时 ms", kind: "number", placeholder: "3000" }],
  }),
  cmd({
    id: "webmcp.invoke",
    group: "webmcp",
    label: "调用工具",
    description: "调用页面提供的 WebMCP 工具",
    engine: "sidecar",
    method: "webmcpInvoke",
    args: [
      { name: "name", label: "工具名", kind: "string", required: true },
      { name: "input", label: "输入 JSON", kind: "json", placeholder: "{}" },
    ],
  }),
  cmd({
    id: "network.on",
    group: "network",
    label: "开始捕获",
    description: "捕获当前会话的请求/响应",
    engine: "browse",
    method: "networkOn",
    browseArgs: ["network", "on"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "network.off",
    group: "network",
    label: "停止捕获",
    description: "停止网络捕获",
    engine: "browse",
    method: "networkOff",
    browseArgs: ["network", "off"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "network.path",
    group: "network",
    label: "捕获目录",
    description: "打印网络捕获目录",
    engine: "browse",
    method: "networkPath",
    browseArgs: ["network", "path"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "network.clear",
    group: "network",
    label: "清空捕获",
    description: "清空已捕获请求",
    engine: "browse",
    method: "networkClear",
    browseArgs: ["network", "clear"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "cdp",
    group: "session",
    label: "CDP 事件",
    description: "附着 CDP 并流式输出 DevTools 事件",
    engine: "browse",
    method: "cdp",
    browseArgs: ["cdp"],
    args: [
      { name: "endpoint", label: "端口 / URL", kind: "string", required: true, placeholder: "9222" },
      { name: "pretty", label: "美化输出", kind: "boolean" },
    ],
    needsSession: false,
  }),
  cmd({
    id: "cloud.projects.list",
    group: "cloud",
    label: "项目列表",
    description: "列出 Browserbase 项目",
    engine: "browse",
    method: "cloudProjectsList",
    browseArgs: ["cloud", "projects", "list"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "cloud.projects.get",
    group: "cloud",
    label: "项目详情",
    description: "读取 Browserbase 项目",
    engine: "browse",
    method: "cloudProjectsGet",
    browseArgs: ["cloud", "projects", "get"],
    args: [{ name: "targetId", label: "项目 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.projects.usage",
    group: "cloud",
    label: "项目用量",
    description: "读取项目用量",
    engine: "browse",
    method: "cloudProjectsUsage",
    browseArgs: ["cloud", "projects", "usage"],
    args: [{ name: "targetId", label: "项目 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.sessions.list",
    group: "cloud",
    label: "云会话列表",
    description: "列出 Browserbase 会话",
    engine: "browse",
    method: "cloudSessionsList",
    browseArgs: ["cloud", "sessions", "list"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "cloud.sessions.create",
    group: "cloud",
    label: "创建云会话",
    description: "创建 Browserbase 会话",
    engine: "browse",
    method: "cloudSessionsCreate",
    browseArgs: ["cloud", "sessions", "create"],
    args: [
      { name: "proxies", label: "代理", kind: "boolean" },
      { name: "verified", label: "Verified", kind: "boolean" },
    ],
    needsSession: false,
  }),
  cmd({
    id: "cloud.sessions.get",
    group: "cloud",
    label: "云会话详情",
    description: "读取 Browserbase 会话",
    engine: "browse",
    method: "cloudSessionsGet",
    browseArgs: ["cloud", "sessions", "get"],
    args: [{ name: "targetId", label: "会话 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.sessions.debug",
    group: "cloud",
    label: "云会话调试",
    description: "获取 live debugger URL",
    engine: "browse",
    method: "cloudSessionsDebug",
    browseArgs: ["cloud", "sessions", "debug"],
    args: [{ name: "targetId", label: "会话 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.sessions.logs",
    group: "cloud",
    label: "云会话日志",
    description: "读取云会话日志",
    engine: "browse",
    method: "cloudSessionsLogs",
    browseArgs: ["cloud", "sessions", "logs"],
    args: [{ name: "targetId", label: "会话 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.fetch",
    group: "cloud",
    label: "Fetch",
    description: "用 Browserbase Fetch API 拉取页面（默认 markdown）",
    engine: "browse",
    method: "cloudFetch",
    browseArgs: ["cloud", "fetch"],
    args: [{ name: "url", label: "URL", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.search",
    group: "cloud",
    label: "Search",
    description: "用 Browserbase Search API 搜索",
    engine: "browse",
    method: "cloudSearch",
    browseArgs: ["cloud", "search"],
    args: [{ name: "query", label: "查询", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.contexts.create",
    group: "cloud",
    label: "创建 Context",
    description: "创建可复用的 Browserbase Context",
    engine: "browse",
    method: "cloudContextsCreate",
    browseArgs: ["cloud", "contexts", "create"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "cloud.contexts.get",
    group: "cloud",
    label: "读取 Context",
    description: "读取 Browserbase Context",
    engine: "browse",
    method: "cloudContextsGet",
    browseArgs: ["cloud", "contexts", "get"],
    args: [{ name: "targetId", label: "Context ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.contexts.delete",
    group: "cloud",
    label: "删除 Context",
    description: "删除 Browserbase Context",
    engine: "browse",
    method: "cloudContextsDelete",
    browseArgs: ["cloud", "contexts", "delete"],
    args: [{ name: "targetId", label: "Context ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.extensions.upload",
    group: "cloud",
    label: "上传扩展",
    description: "上传扩展 zip 到 Browserbase",
    engine: "browse",
    method: "cloudExtensionsUpload",
    browseArgs: ["cloud", "extensions", "upload"],
    args: [{ name: "file", label: "zip 路径", kind: "file", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.extensions.get",
    group: "cloud",
    label: "扩展详情",
    description: "读取已上传扩展",
    engine: "browse",
    method: "cloudExtensionsGet",
    browseArgs: ["cloud", "extensions", "get"],
    args: [{ name: "targetId", label: "扩展 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "cloud.extensions.delete",
    group: "cloud",
    label: "删除扩展",
    description: "删除已上传扩展",
    engine: "browse",
    method: "cloudExtensionsDelete",
    browseArgs: ["cloud", "extensions", "delete"],
    args: [{ name: "targetId", label: "扩展 ID", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "skills.list",
    group: "skills",
    label: "技能目录",
    description: "列出 browse.sh 公开技能",
    engine: "browse",
    method: "skillsList",
    browseArgs: ["skills", "list"],
    args: [{ name: "all", label: "全部条目", kind: "boolean" }],
    needsSession: false,
  }),
  cmd({
    id: "skills.find",
    group: "skills",
    label: "搜索技能",
    description: "按 slug / 域名 / 标题搜索技能",
    engine: "browse",
    method: "skillsFind",
    browseArgs: ["skills", "find"],
    args: [{ name: "query", label: "关键词", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "skills.add",
    group: "skills",
    label: "安装技能",
    description: "从 browse.sh 安装技能",
    engine: "browse",
    method: "skillsAdd",
    browseArgs: ["skills", "add"],
    args: [{ name: "slug", label: "技能 slug", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "skills.install",
    group: "skills",
    label: "安装 CLI 技能",
    description: "安装捆绑的 browse CLI skill",
    engine: "browse",
    method: "skillsInstall",
    browseArgs: ["skills", "install"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "functions.init",
    group: "functions",
    label: "初始化函数",
    description: "脚手架一个 Browserbase Function 项目",
    engine: "browse",
    method: "functionsInit",
    browseArgs: ["functions", "init"],
    args: [{ name: "name", label: "名称", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "functions.dev",
    group: "functions",
    label: "本地开发",
    description: "启动 Function 本地开发服务",
    engine: "browse",
    method: "functionsDev",
    browseArgs: ["functions", "dev"],
    args: [{ name: "file", label: "入口文件", kind: "file", required: true, placeholder: "index.ts" }],
    needsSession: false,
  }),
  cmd({
    id: "functions.publish",
    group: "functions",
    label: "发布函数",
    description: "打包并上传 Function",
    engine: "browse",
    method: "functionsPublish",
    browseArgs: ["functions", "publish"],
    args: [{ name: "file", label: "入口文件", kind: "file", required: true, placeholder: "index.ts" }],
    needsSession: false,
  }),
  cmd({
    id: "functions.invoke",
    group: "functions",
    label: "调用函数",
    description: "调用已发布的 Function",
    engine: "browse",
    method: "functionsInvoke",
    browseArgs: ["functions", "invoke"],
    args: [
      { name: "functionId", label: "函数 ID", kind: "string", required: true },
      { name: "params", label: "参数 JSON", kind: "json", placeholder: "{}" },
    ],
    needsSession: false,
  }),
  cmd({
    id: "templates.list",
    group: "templates",
    label: "模板列表",
    description: "列出 Browserbase 示例模板",
    engine: "browse",
    method: "templatesList",
    browseArgs: ["templates", "list"],
    args: [],
    needsSession: false,
  }),
  cmd({
    id: "templates.find",
    group: "templates",
    label: "搜索模板",
    description: "搜索示例模板",
    engine: "browse",
    method: "templatesFind",
    browseArgs: ["templates", "find"],
    args: [{ name: "query", label: "关键词", kind: "string", required: true }],
    needsSession: false,
  }),
  cmd({
    id: "templates.clone",
    group: "templates",
    label: "克隆模板",
    description: "脚手架示例项目",
    engine: "browse",
    method: "templatesClone",
    browseArgs: ["templates", "clone"],
    args: [{ name: "slug", label: "模板 slug", kind: "string", required: true }],
    needsSession: false,
  }),
];

export function getStagehandCommand(id: string): StagehandCommandSpec | undefined {
  return STAGEHAND_COMMANDS.find((item) => item.id === id);
}

export function commandsForGroup(group: StagehandCommandGroupId): StagehandCommandSpec[] {
  return STAGEHAND_COMMANDS.filter((item) => item.group === group);
}

export function commandsForSurface(surface: StagehandSurfaceId): StagehandCommandSpec[] {
  const groups = STAGEHAND_SURFACES.find((item) => item.id === surface)?.groups ?? [];
  return STAGEHAND_COMMANDS.filter((item) => groups.includes(item.group));
}

export function surfaceForCommand(commandId: string): StagehandSurfaceId {
  const spec = getStagehandCommand(commandId);
  if (!spec) return "ai";
  const found = STAGEHAND_SURFACES.find((surface) => surface.groups.includes(spec.group));
  return found?.id ?? "ai";
}

export function sanitizeBrowseSessionName(sessionId: string): string {
  const safe = sessionId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `wise-${safe || "default"}`;
}

export type StagehandFormValues = Record<string, string | number | boolean | null | undefined>;

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseJsonValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

export function buildSidecarParams(
  spec: StagehandCommandSpec,
  values: StagehandFormValues,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const arg of spec.args) {
    const raw = values[arg.name];
    if (arg.kind === "boolean") {
      if (raw === true || raw === "true" || raw === 1 || raw === "1") params[arg.name] = true;
      continue;
    }
    if (arg.kind === "number") {
      const n = typeof raw === "number" ? raw : Number(asString(raw));
      if (Number.isFinite(n)) params[arg.name] = n;
      else if (arg.required) throw new Error(`${arg.label} 必须是数字`);
      continue;
    }
    if (arg.kind === "json") {
      const text = asString(raw);
      if (!text) {
        if (arg.required) throw new Error(`${arg.label} 不能为空`);
        continue;
      }
      try {
        params[arg.name] = parseJsonValue(text);
      } catch {
        throw new Error(`${arg.label} 不是合法 JSON`);
      }
      continue;
    }
    const text = asString(raw);
    if (!text) {
      if (arg.required) throw new Error(`${arg.label} 不能为空`);
      continue;
    }
    params[arg.name] = text;
  }
  return params;
}

export function buildBrowseArgv(
  spec: StagehandCommandSpec,
  values: StagehandFormValues,
  _sessionName?: string,
): string[] {
  if (spec.engine !== "browse" && !spec.browseArgs?.length) {
    throw new Error(`${spec.id} 不是 browse CLI 命令`);
  }
  const argv = [...(spec.browseArgs ?? [spec.method])];
  for (const arg of spec.args) {
    const raw = values[arg.name];
    if (arg.kind === "boolean") {
      if (raw === true || raw === "true" || raw === 1 || raw === "1") {
        argv.push(`--${arg.name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`);
      }
      continue;
    }
    const text = asString(raw);
    if (!text) {
      if (arg.required) throw new Error(`${arg.label} 不能为空`);
      continue;
    }
    if (arg.kind === "json") {
      argv.push("--params", text);
      continue;
    }
    if (
      arg.name === "target" ||
      arg.name === "url" ||
      arg.name === "query" ||
      arg.name === "slug" ||
      arg.name === "name" ||
      arg.name === "functionId" ||
      arg.name === "text" ||
      arg.name === "value" ||
      arg.name === "key" ||
      arg.name === "file" ||
      arg.name === "expression" ||
      arg.name === "field" ||
      arg.name === "state" ||
      arg.name === "ms" ||
      arg.name === "targetId" ||
      arg.name === "endpoint" ||
      arg.name === "x" ||
      arg.name === "y" ||
      arg.name === "dx" ||
      arg.name === "dy" ||
      arg.name === "x1" ||
      arg.name === "y1" ||
      arg.name === "x2" ||
      arg.name === "y2" ||
      arg.name === "width" ||
      arg.name === "height"
    ) {
      argv.push(text);
      continue;
    }
    argv.push(`--${arg.name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`, text);
  }
  return argv;
}
