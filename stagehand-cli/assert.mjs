/**
 * Deterministic page assertions and acceptance-suite helpers for wise browse.
 * No browser import — callers supply actual values or parsed steps.
 */

export const COMPARE_OPS = ["equals", "contains", "matches", "not_equals", "not_contains", "starts_with", "ends_with"];
export const STATE_ASSERTS = ["visible", "hidden", "checked"];
export const VALUE_FIELDS = ["url", "title", "text", "html", "value", "markdown"];

const OP_ALIASES = {
  equals: "equals",
  eq: "equals",
  "=": "equals",
  等于: "equals",
  contains: "contains",
  include: "contains",
  includes: "contains",
  包含: "contains",
  matches: "matches",
  match: "matches",
  regex: "matches",
  匹配: "matches",
  not_equals: "not_equals",
  ne: "not_equals",
  "!=": "not_equals",
  不等于: "not_equals",
  not_contains: "not_contains",
  不包含: "not_contains",
  starts_with: "starts_with",
  startswith: "starts_with",
  开头: "starts_with",
  ends_with: "ends_with",
  endswith: "ends_with",
  结尾: "ends_with",
};

/**
 * @param {unknown} actual
 * @param {string} op
 * @param {unknown} expected
 */
export function evaluateCompare(actual, op, expected) {
  const normalized = OP_ALIASES[String(op ?? "contains").trim().toLowerCase()] ?? String(op ?? "contains");
  const left = stringifyActual(actual);
  const right = stringifyActual(expected);
  let passed = false;
  switch (normalized) {
    case "equals":
      passed = left === right;
      break;
    case "not_equals":
      passed = left !== right;
      break;
    case "contains":
      passed = left.includes(right);
      break;
    case "not_contains":
      passed = !left.includes(right);
      break;
    case "starts_with":
      passed = left.startsWith(right);
      break;
    case "ends_with":
      passed = left.endsWith(right);
      break;
    case "matches": {
      try {
        passed = new RegExp(right).test(left);
      } catch (error) {
        return {
          passed: false,
          op: normalized,
          actual: left,
          expected: right,
          message: `正则无效：${error.message}`,
        };
      }
      break;
    }
    default:
      return {
        passed: false,
        op: normalized,
        actual: left,
        expected: right,
        message: `不支持的比较：${op}`,
      };
  }
  return {
    passed,
    op: normalized,
    actual: left,
    expected: right,
    message: passed
      ? `通过：${normalized} 「${truncate(right)}」`
      : `失败：期望 ${normalized} 「${truncate(right)}」，实际 「${truncate(left)}」`,
  };
}

/**
 * @param {{ state?: string; actual?: boolean }} input
 */
export function evaluateState(input) {
  const state = String(input.state ?? "visible").toLowerCase();
  const actual = Boolean(input.actual);
  let passed = actual;
  if (state === "hidden") passed = !actual;
  if (state === "checked") passed = actual;
  if (state === "visible") passed = actual;
  return {
    passed,
    op: state,
    actual,
    expected: state !== "hidden",
    message: passed ? `通过：${state}` : `失败：期望 ${state}，实际 ${actual}`,
  };
}

/**
 * Parse `assert title contains Google` / `assert visible css=button` / Chinese ops.
 * @param {string[]} rest
 * @param {Record<string, string | boolean>} flags
 */
export function parseAssertSpec(rest, flags = {}) {
  const parts = (rest ?? []).map((item) => String(item));
  const target = typeof flags.target === "string" ? flags.target : undefined;
  if (parts.length === 0) {
    throw new Error("assert 需要表达式，例如 wise browse assert title contains Google");
  }
  const head = parts[0].toLowerCase();
  if (STATE_ASSERTS.includes(head) || head === "可见" || head === "不可见") {
    const state = head === "可见" ? "visible" : head === "不可见" ? "hidden" : head;
    const selector = parts.slice(1).join(" ").trim();
    if (!selector) throw new Error(`assert ${state} 需要选择器`);
    return { kind: "state", state, target: selector };
  }
  if (VALUE_FIELDS.includes(head)) {
    const opRaw = parts[1];
    const value = parts.slice(2).join(" ");
    if (!opRaw || value === "") {
      throw new Error(`assert ${head} 需要比较与期望值，例如 assert ${head} contains ...`);
    }
    const op = OP_ALIASES[opRaw.toLowerCase()] ?? opRaw;
    return { kind: "compare", field: head, op, value, target };
  }
  const phrase = parseAssertPhrase(parts.join(" "));
  if (phrase) return { ...phrase, target: phrase.target ?? target };
  throw new Error(`无法解析断言：${parts.join(" ")}`);
}

/**
 * @param {string} text
 * @returns {null | Record<string, unknown>}
 */
export function parseAssertPhrase(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const stateMatch = raw.match(/^(visible|hidden|checked|可见|不可见)\s+(.+)$/iu);
  if (stateMatch) {
    const token = stateMatch[1].toLowerCase();
    const state = token === "可见" ? "visible" : token === "不可见" ? "hidden" : token;
    return { kind: "state", state, target: stateMatch[2].trim() };
  }
  const compareMatch = raw.match(
    /^(url|title|text|html|value|markdown)\s+(equals|eq|contains|包含|等于|matches|匹配|not_contains|不包含|starts_with|ends_with|=)\s+(.+)$/iu,
  );
  if (compareMatch) {
    return {
      kind: "compare",
      field: compareMatch[1].toLowerCase(),
      op: OP_ALIASES[compareMatch[2].toLowerCase()] ?? compareMatch[2],
      value: compareMatch[3].trim(),
    };
  }
  const cnState = raw.match(/^(应该|必须)?\s*(可见|不可见)\s+(.+)$/u);
  if (cnState) {
    return {
      kind: "state",
      state: cnState[2] === "不可见" ? "hidden" : "visible",
      target: cnState[3].trim(),
    };
  }
  const cn = raw.match(/^(标题|网址|正文|文本|页面)\s*(应该|必须|不能|不得)?\s*(包含|等于|不包含)\s*(.+)$/u);
  if (cn) {
    const field = cn[1] === "网址" ? "url" : cn[1] === "标题" ? "title" : "text";
    let op = cn[3] === "等于" ? "equals" : cn[3] === "不包含" ? "not_contains" : "contains";
    if (cn[2] === "不能" || cn[2] === "不得") {
      op = op === "equals" ? "not_equals" : "not_contains";
    }
    return { kind: "compare", field, op, value: cn[4].trim() };
  }
  return null;
}

export const DEFAULT_ACCEPT_SUITE = {
  name: "登录页验收",
  url: "https://example.com/login",
  screenshotOnFail: true,
  stopOnFail: false,
  retries: 0,
  steps: [
    { open: "https://example.com/login" },
    { wait: { selector: "css=form", state: "visible", timeout: 5000 } },
    { assert: "title contains 登录" },
    { assert: { visible: "css=button[type=submit]" } },
    { screenshot: true },
    { expect: "页面有用户名和密码输入框", soft: true },
  ],
};

/**
 * @param {unknown} raw
 */
export function parseSuiteDocument(raw) {
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("验收套件必须是 JSON 对象");
  }
  const name = String(doc.name ?? doc.title ?? "browser-accept").trim() || "browser-accept";
  const url = typeof doc.url === "string" ? doc.url.trim() : "";
  const screenshotOnFail = doc.screenshotOnFail !== false;
  const stopOnFail = doc.stopOnFail === true;
  const retries = Number.isFinite(Number(doc.retries)) ? Math.max(0, Number(doc.retries)) : 0;
  const sourceSteps = Array.isArray(doc.steps)
    ? doc.steps
    : Array.isArray(doc.checks)
      ? doc.checks
      : Array.isArray(doc.assertions)
        ? doc.assertions
        : [];
  if (sourceSteps.length === 0 && !url) {
    throw new Error("验收套件缺少 steps / checks");
  }
  const steps = sourceSteps.map((item, index) => normalizeSuiteStep(item, index));
  if (url && (steps.length === 0 || steps[0].action !== "open")) {
    steps.unshift({ id: "open-0", action: "open", url, label: `打开 ${url}` });
  }
  return { name, url, screenshotOnFail, stopOnFail, retries, steps };
}

export function suiteFromChecks(input) {
  const url = String(input.url ?? "").trim();
  const checks = Array.isArray(input.checks) ? input.checks : [];
  if (!url && checks.length === 0) {
    throw new Error("test / accept 需要 --file 套件或 --url 加 --check");
  }
  const steps = checks.map((item, index) => normalizeSuiteStep(item, index));
  return parseSuiteDocument({
    name: input.name || "session-check",
    url,
    screenshotOnFail: input.screenshotOnFail !== false,
    stopOnFail: input.stopOnFail === true,
    retries: input.retries ?? 0,
    steps,
  });
}

export function buildSuiteReport(input) {
  const results = Array.isArray(input.results) ? input.results : [];
  const failed = results.filter((item) => item.passed === false).length;
  const passed = results.filter((item) => item.passed === true).length;
  const skipped = results.filter((item) => item.passed == null).length;
  const ok = failed === 0 && results.length > 0;
  return {
    kind: input.kind === "test" ? "test" : "acceptance",
    name: input.name || "browser-accept",
    passed: ok,
    summary: ok
      ? `通过 ${passed}/${results.length}`
      : `未通过：失败 ${failed}，通过 ${passed}，共 ${results.length}`,
    counts: { passed, failed, skipped, total: results.length },
    durationMs: Number(input.durationMs ?? 0) || results.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0),
    results,
    screenshotOnFail: Boolean(input.screenshotOnFail),
    at: input.at || new Date().toISOString(),
    reportPath: input.reportPath || null,
    markdownPath: input.markdownPath || null,
  };
}

export function formatMarkdownReport(report) {
  const passed = report?.passed === true;
  const counts = report?.counts ?? {};
  const lines = [
    `# ${report?.kind === "test" ? "测试" : "验收"}报告：${report?.name || "browser-accept"}`,
    "",
    `- 结果：**${passed ? "通过" : "未通过"}**`,
    `- 统计：通过 ${counts.passed ?? 0}，失败 ${counts.failed ?? 0}，共 ${counts.total ?? 0}`,
    `- 耗时：${Number(report?.durationMs) || 0}ms`,
    `- 时间：${report?.at || ""}`,
    "",
    "## 步骤",
    "",
  ];
  const results = Array.isArray(report?.results) ? report.results : [];
  results.forEach((item, index) => {
    const mark = item.passed === false ? (item.soft ? "⚠" : "✗") : "✓";
    const dur = Number(item.durationMs) ? ` (${item.durationMs}ms)` : "";
    lines.push(`${index + 1}. ${mark} ${item.label || item.action || `步骤 ${index + 1}`}${dur}`);
    if (item.message) lines.push(`   - ${item.message}`);
    if (item.screenshot) lines.push(`   - 截图：${item.screenshot}`);
  });
  if (results.length === 0) lines.push("（无步骤）");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function summarizeLatestPointer(report) {
  return {
    kind: report?.kind || "acceptance",
    name: report?.name || "browser-accept",
    passed: report?.passed === true,
    summary: report?.summary || "",
    at: report?.at || new Date().toISOString(),
    counts: report?.counts || { passed: 0, failed: 0, skipped: 0, total: 0 },
    durationMs: Number(report?.durationMs) || 0,
    jsonPath: report?.reportPath || null,
    markdownPath: report?.markdownPath || null,
  };
}

export function isAssertionFailure(result) {
  return Boolean(result && typeof result === "object" && result.passed === false);
}

function normalizeSuiteStep(item, index) {
  if (typeof item === "string") {
    const phrase = parseAssertPhrase(item);
    if (phrase) {
      return { id: `assert-${index + 1}`, action: "assert", spec: phrase, label: item };
    }
    return { id: `expect-${index + 1}`, action: "expect", instruction: item, label: item };
  }
  if (!item || typeof item !== "object") {
    throw new Error(`套件第 ${index + 1} 步无效`);
  }
  if (item.open || item.action === "open") {
    const url = String(item.open ?? item.url ?? "").trim();
    return withSoft({ id: item.id || `open-${index + 1}`, action: "open", url, label: item.label || `打开 ${url}` }, item);
  }
  if (item.wait || item.action === "wait") {
    const wait = item.wait && typeof item.wait === "object" ? item.wait : item;
    const ms = Number(wait.ms ?? wait.timeout ?? (typeof item.wait === "number" ? item.wait : 0));
    const target = String(wait.selector ?? wait.target ?? "").trim();
    const state = String(wait.state ?? "visible");
    return withSoft({
      id: item.id || `wait-${index + 1}`,
      action: "wait",
      ms,
      target,
      state,
      label: item.label || (target ? `等待 ${target}` : `等待 ${ms}ms`),
    }, item);
  }
  if (item.screenshot || item.action === "screenshot") {
    const shot = item.screenshot && typeof item.screenshot === "object" ? item.screenshot : {};
    return withSoft({
      id: item.id || `screenshot-${index + 1}`,
      action: "screenshot",
      fullPage: shot.fullPage !== false,
      path: shot.path,
      label: item.label || "截图",
    }, item);
  }
  if (item.act || item.action === "act") {
    const instruction = String(item.act ?? item.instruction ?? "").trim();
    return withSoft({ id: item.id || `act-${index + 1}`, action: "act", instruction, label: item.label || instruction }, item);
  }
  if (item.expect || item.check || item.action === "expect") {
    const instruction = String(item.expect ?? item.check ?? item.instruction ?? "").trim();
    return withSoft({ id: item.id || `expect-${index + 1}`, action: "expect", instruction, label: item.label || instruction }, item);
  }
  if (item.assert || item.action === "assert") {
    const spec = typeof item.assert === "string" ? parseAssertPhrase(item.assert) : item.assert || item.spec || item;
    if (!spec || spec.kind == null) {
      if (spec && (spec.field || spec.state || spec.visible)) {
        const normalized = normalizeLooseAssert(spec);
        return withSoft({ id: item.id || `assert-${index + 1}`, action: "assert", spec: normalized, label: item.label || describeSpec(normalized) }, item);
      }
      throw new Error(`套件第 ${index + 1} 步断言无效`);
    }
    return withSoft({ id: item.id || `assert-${index + 1}`, action: "assert", spec, label: item.label || describeSpec(spec) }, item);
  }
  if (item.visible) {
    const spec = { kind: "state", state: "visible", target: String(item.visible) };
    return withSoft({ id: item.id || `assert-${index + 1}`, action: "assert", spec, label: item.label || describeSpec(spec) }, item);
  }
  throw new Error(`套件第 ${index + 1} 步无法识别`);
}

function withSoft(step, item) {
  if (item && item.soft === true) step.soft = true;
  if (item && Number.isFinite(Number(item.retries))) step.retries = Math.max(0, Number(item.retries));
  return step;
}

function normalizeLooseAssert(spec) {
  if (spec.visible) return { kind: "state", state: "visible", target: String(spec.visible) };
  if (spec.hidden) return { kind: "state", state: "hidden", target: String(spec.hidden) };
  if (spec.checked) return { kind: "state", state: "checked", target: String(spec.checked) };
  if (spec.state) return { kind: "state", state: String(spec.state), target: String(spec.target ?? "") };
  return {
    kind: "compare",
    field: String(spec.field ?? "text"),
    op: spec.op ?? "contains",
    value: spec.value ?? spec.expected ?? "",
    target: spec.target,
  };
}

function describeSpec(spec) {
  if (spec.kind === "state") return `${spec.state} ${spec.target}`;
  return `${spec.field} ${spec.op} ${spec.value}`;
}

function stringifyActual(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text, max = 180) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function interpretExpectPayload(payload) {
  if (typeof payload === "boolean") {
    return { passed: payload, reason: payload ? "通过" : "未通过", actual: payload };
  }
  if (typeof payload === "string") {
    const lower = payload.trim().toLowerCase();
    if (["true", "yes", "pass", "passed", "通过"].includes(lower)) {
      return { passed: true, reason: payload, actual: payload };
    }
    if (["false", "no", "fail", "failed", "不通过", "失败"].includes(lower)) {
      return { passed: false, reason: payload, actual: payload };
    }
  }
  if (payload && typeof payload === "object") {
    const obj = payload;
    const nested = obj.data && typeof obj.data === "object" ? obj.data : obj;
    if (typeof nested.passed === "boolean") {
      return { passed: nested.passed, reason: String(nested.reason ?? nested.message ?? ""), actual: nested };
    }
    if (typeof nested.ok === "boolean" && nested.passed == null) {
      return { passed: nested.ok, reason: String(nested.reason ?? nested.message ?? ""), actual: nested };
    }
  }
  return { passed: false, reason: "无法从抽取结果判断是否通过", actual: payload };
}
