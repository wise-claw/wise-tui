export interface CanvasAssetReader {
  text(path: string): Promise<string>;
  base64(path: string): Promise<string>;
}

/** Resolve only repository-local paths. Never read a remote URL or escape the root. */
export function resolveCanvasAssetPath(from: string, reference: string): string | null {
  const raw = reference.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[\w+.-]+:/.test(raw)) return null;
  const decoded = decodeURIComponent(raw.split(/[?#]/)[0]);
  if (decoded.includes("\\") || decoded.includes("\0")) throw new Error("不支持的资源路径");
  const parts = raw.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("资源路径超出仓库");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

const mimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  js: "text/javascript", mjs: "text/javascript",
};

export async function inlineCanvasAssets(content: string, path: string, reader: CanvasAssetReader) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  const warnings = new Set<string>();
  const cache = new Map<string, Promise<string>>();
  const asset = async (reference: string, from: string): Promise<string> => {
    try {
      const resolved = resolveCanvasAssetPath(from, reference);
      if (resolved === null) return reference;
      const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
      const mime = mimeTypes[ext];
      if (!mime) throw new Error("不支持的资源类型");
      if (!cache.has(resolved)) {
        if (cache.size >= 64) throw new Error("资源数量超过 64 个");
        cache.set(resolved, reader.base64(resolved).then((data) => `data:${mime};base64,${data}`));
      }
      const fragment = reference.includes("#") ? `#${reference.split("#").slice(1).join("#")}` : "";
      return (await cache.get(resolved)!) + fragment;
    } catch (error) {
      warnings.add(`${reference}：${error instanceof Error ? error.message : String(error)}`);
      return reference;
    }
  };
  const css = async (source: string, from: string) => {
    if (/@import\b/i.test(source)) warnings.add(`${from}：CSS @import 需合并到样式文件`);
    const matches = [...source.matchAll(/url\(\s*(['"]?)([^'"()]*?)\1\s*\)/gi)];
    for (const match of matches.reverse()) {
      const url = await asset(match[2], from);
      source = source.slice(0, match.index) + `url(${JSON.stringify(url)})` + source.slice(match.index! + match[0].length);
    }
    return source;
  };
  let stylesheets = 0;
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')) {
    try {
      const resolved = resolveCanvasAssetPath(path, link.getAttribute("href")!);
      if (resolved === null) continue;
      if (++stylesheets > 32) throw new Error("样式文件超过 32 个");
      const style = doc.createElement("style");
      style.textContent = await css(await reader.text(resolved), resolved);
      if (link.media) style.setAttribute("media", link.media);
      link.replaceWith(style);
    } catch (error) { warnings.add(`${link.getAttribute("href")}：${String(error)}`); }
  }
  for (const node of doc.querySelectorAll("style")) node.textContent = await css(node.textContent ?? "", path);
  for (const node of doc.querySelectorAll("[style]")) node.setAttribute("style", await css(node.getAttribute("style")!, path));
  for (const node of doc.querySelectorAll("img[src], script[src], image[href], image[xlink\\:href]")) {
    const attr = node.hasAttribute("src") ? "src" : node.hasAttribute("href") ? "href" : "xlink:href";
    if (node.getAttribute("type") === "module") warnings.add("模块脚本的相对 import 需先打包");
    node.setAttribute(attr, await asset(node.getAttribute(attr)!, path));
  }
  if (doc.querySelector("[srcset]")) warnings.add("响应式图片 srcset 需使用内嵌或 HTTPS 地址");
  return { content: doc.documentElement.outerHTML, warnings: [...warnings] };
}
