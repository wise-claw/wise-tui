/**
 * Login-state helpers for wise browse. Pure — no browser import.
 */

const LOGIN_PATH = /\/(login|signin|sign-in|sign_in|sso|oauth|auth)(\b|\/|\?|#|$)/i;
const SESSION_COOKIE =
  /(sessionid|session_id|jsessionid|phpsessid|connect\.sid|session[-_]token|access[-_]token|refresh[-_]token|id[-_]token|auth[-_]?token|logged[-_]?in)/i;

export function sanitizeAuthProfileName(raw) {
  const value = String(raw ?? "default").trim() || "default";
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return safe || "default";
}

export function isLoginUrl(url) {
  return LOGIN_PATH.test(String(url ?? ""));
}

/**
 * @param {{ url?: string; cookies?: Array<{ name?: string }>; startUrl?: string; startCookieCount?: number }} input
 */
export function looksLoggedIn(input = {}) {
  const url = String(input.url ?? "");
  const startUrl = String(input.startUrl ?? "");
  const cookies = Array.isArray(input.cookies) ? input.cookies : [];
  const startCount = Number(input.startCookieCount) || 0;
  if (startUrl && isLoginUrl(startUrl) && url.startsWith("http") && !isLoginUrl(url)) {
    return { ok: true, reason: "已离开登录页" };
  }
  if (cookies.length > startCount) {
    return { ok: true, reason: `Cookie 增至 ${cookies.length}` };
  }
  if (cookies.some((item) => SESSION_COOKIE.test(String(item?.name ?? "")))) {
    return { ok: true, reason: "检测到会话 Cookie" };
  }
  return { ok: false, reason: "仍在等待登录" };
}

export function summarizeAuthState(input = {}) {
  const profile = sanitizeAuthProfileName(input.profile);
  const persist = input.persist !== false;
  const cookies = Number(input.cookieCount) || 0;
  if (input.env === "cdp") return "使用调试口当前 Chrome 的登录态";
  if (!persist) return `未记住登录态（档案 ${profile}）`;
  if (cookies > 0) return `已记住登录态 · ${profile} · ${cookies} 个 Cookie`;
  if (input.snapshot) return `已记住登录态 · ${profile}（有快照）`;
  return `已启用登录态 · ${profile}（尚未登录）`;
}

export function parseAuthPhrase(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (/^(查看|看)?(当前)?(登录态|登录状态|cookie)$/u.test(raw)) {
    return { action: "status" };
  }
  if (/^(保存|记下)(当前)?(登录态|登录状态|cookie)$/u.test(raw)) {
    return { action: "save" };
  }
  if (/^(加载|恢复|读取)(登录态|登录状态)$/u.test(raw)) {
    return { action: "load" };
  }
  if (/^(等待|等我)(手动)?登录/u.test(raw)) {
    return { action: "wait" };
  }
  if (/^(清除|清空|忘掉)(登录态|登录状态)$/u.test(raw)) {
    return { action: "clear" };
  }
  return null;
}
