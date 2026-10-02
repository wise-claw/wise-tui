/**
 * 仓库内 Markdown 相对链接解析。
 *
 * Markdown 文档里的 `docs/i18n.md` 这类链接若交给 WebView 处理，会相对应用自身
 * 的 URL 解析（指向 Wise 前端路径），而不是当前仓库。这里把链接还原成仓库相对路径，
 * 交给文件编辑器打开。
 */

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function repositoryDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

/** 取出链接中的路径部分；锚点、外链（协议 / 协议相对）返回 null。 */
function markdownLinkPath(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("//")) return null;
  if (URL_SCHEME_RE.test(trimmed)) return null;
  const withoutFragment = trimmed.split("#")[0]!.split("?")[0]!;
  if (!withoutFragment) return null;
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  return decoded.replace(/\\/g, "/");
}

/**
 * 把 Markdown 链接解析为仓库相对路径。
 *
 * - `./`、`../` 相对当前文件所在目录解析；`/foo.md` 视为仓库根相对。
 * - 锚点（`#x`）、外链（`http:`、`mailto:`、`//`）返回 null。
 * - 越出仓库根（`../` 过多）返回 null，避免把链接解析到仓库之外。
 */
export function resolveRepositoryMarkdownPath(
  fromRelativePath: string,
  href: string,
): string | null {
  const rawPath = markdownLinkPath(href);
  if (rawPath == null) return null;

  const fromDir = repositoryDirname(fromRelativePath);
  const joined = rawPath.startsWith("/")
    ? rawPath.replace(/^\/+/, "")
    : `${fromDir ? `${fromDir}/` : ""}${rawPath}`;

  const segments: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/** 是否为需要交给仓库文件编辑器打开的链接（排除锚点与外链）。 */
export function isRepositoryMarkdownHref(href: string | undefined | null): boolean {
  if (!href) return false;
  return markdownLinkPath(href) != null;
}
