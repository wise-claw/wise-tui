/**
 * 将 `git remote` 的 origin URL 转为可在浏览器打开的 HTTPS 仓库主页链接。
 * 支持常见 https / ssh / scp 形式；无法识别时返回 null。
 */
export function gitRemoteUrlToBrowseUrl(remoteUrl: string): string | null {
  const raw = remoteUrl.trim();
  if (!raw) return null;

  const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(raw);
  if (scp) {
    const host = scp[1];
    const path = scp[2].replace(/\.git$/i, "").replace(/^\/+/, "");
    if (!host || !path) return null;
    return `https://${host}/${path}`;
  }

  if (raw.startsWith("ssh://")) {
    try {
      const u = new URL(raw);
      const path = u.pathname.replace(/\.git$/i, "").replace(/^\/+/, "");
      if (!u.hostname || !path) return null;
      return `https://${u.hostname}/${path}`;
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      let pathname = u.pathname.replace(/\.git$/i, "");
      if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }
      return `${u.protocol}//${u.host}${pathname}${u.search}${u.hash}`;
    } catch {
      return null;
    }
  }

  return null;
}
