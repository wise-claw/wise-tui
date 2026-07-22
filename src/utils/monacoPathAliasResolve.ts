/**
 * Vite/tsconfig 风格路径别名与 import 绑定名解析（纯函数）。
 *
 * 典型：
 *   import * as UserApi from '@/api/system/user'
 *   import { ChatConversationApi } from '@/api/ai/chat/conversation'
 *
 * `@/x` ≠ npm scope 包 `@scope/pkg`：前者是仓库内别名，默认映射到 `src/x`。
 */

/** `@/foo`、`~/foo` 等仓库内别名（不是 `@scope/pkg`）。 */
export function isTsPathAliasSpecifier(specifier: string): boolean {
  const token = specifier.trim();
  return /^[@~#]\//.test(token);
}

/**
 * 将 tsconfig `paths` 模式应用到 specifier，返回去掉 `*` 后的目标前缀路径（仓库相对）。
 *
 * 例：pattern `@/*` + targets `["src/*"]` + specifier `@/api/user`
 *   → `src/api/user`
 */
export function applyTsconfigPathMappings(
  specifier: string,
  paths: Record<string, string[] | undefined> | null | undefined,
  baseUrl = ".",
): string[] {
  const token = specifier.trim();
  if (!token || !paths) return [];

  const out: string[] = [];
  const base = normalizeRelative(baseUrl);

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const mapped = matchPathPattern(pattern.trim(), targets, token);
    for (const item of mapped) {
      const joined = base && base !== "." ? normalizeRelative(`${base}/${item}`) : normalizeRelative(item);
      if (joined) out.push(joined);
    }
  }
  return Array.from(new Set(out));
}

function matchPathPattern(pattern: string, targets: string[], specifier: string): string[] {
  if (!pattern) return [];

  // `@/*` → prefix `@/`, star
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // `@/`
    if (!specifier.startsWith(prefix)) return [];
    const rest = specifier.slice(prefix.length);
    return targets.flatMap((target) => {
      const t = target.trim();
      if (!t) return [];
      if (t.endsWith("/*")) {
        return [normalizeRelative(`${t.slice(0, -1)}${rest}`)];
      }
      return [normalizeRelative(t)];
    });
  }

  // 精确匹配 `@` → `src`
  if (pattern === specifier) {
    return targets.map((t) => normalizeRelative(t.trim())).filter(Boolean);
  }

  return [];
}

/**
 * 默认别名兜底（无 tsconfig 或 paths 未命中时）：
 *   `@/x` → `src/x`、`x`
 *   `~/x` → `src/x`、`x`
 */
export function resolveDefaultPathAliasBases(specifier: string): string[] {
  const token = specifier.trim();
  if (!isTsPathAliasSpecifier(token)) return [];
  const rest = token.replace(/^[@~#]\//, "");
  if (!rest) return [];
  return Array.from(new Set([normalizeRelative(`src/${rest}`), normalizeRelative(rest)]));
}

/** 别名解析出的「无扩展名」基底 → 带扩展名 / index 候选。 */
export function expandAliasPathCandidates(basePaths: readonly string[]): string[] {
  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".json",
    ".d.ts",
  ];
  const indexExtensions = [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"];
  const out: string[] = [];
  for (const base of basePaths) {
    const normalized = normalizeRelative(base);
    if (!normalized) continue;
    const ext = getExt(normalized);
    if (ext) {
      out.push(normalized);
      if (["js", "mjs", "cjs"].includes(ext)) {
        const without = normalized.slice(0, -(ext.length + 1));
        out.push(`${without}.ts`, `${without}.tsx`, `${without}.mts`, `${without}.cts`, `${without}.d.ts`);
      }
      // Vue 文件名首字母大小写兜底：Index.vue ↔ index.vue
      if (ext === "vue") {
        const parts = normalized.split("/");
        const file = parts[parts.length - 1]!;
        if (file.length > 4) {
          const flipped =
            file[0] === file[0]!.toUpperCase()
              ? `${file[0]!.toLowerCase()}${file.slice(1)}`
              : `${file[0]!.toUpperCase()}${file.slice(1)}`;
          const dir = parts.slice(0, -1).join("/");
          const flippedPath = dir ? `${dir}/${flipped}` : flipped;
          if (flippedPath !== normalized) out.push(flippedPath);
        }
      }
      continue;
    }
    for (const e of extensions) {
      if (e) out.push(`${normalized}${e}`);
    }
    for (const e of indexExtensions) {
      out.push(`${normalized}/index${e}`);
    }
  }
  return Array.from(new Set(out));
}

/**
 * 综合：tsconfig paths → 默认 `@/` 兜底（两者合并，避免 tsconfig 映射与真实目录不一致时跳转失败）。
 */
export function resolvePathAliasImportCandidates(
  specifier: string,
  options?: {
    paths?: Record<string, string[] | undefined> | null;
    baseUrl?: string;
  },
): string[] {
  const token = specifier.trim();
  if (!token) return [];

  const fromTsconfig = applyTsconfigPathMappings(token, options?.paths, options?.baseUrl ?? ".");
  const defaults = isTsPathAliasSpecifier(token) ? resolveDefaultPathAliasBases(token) : [];
  const bases = Array.from(new Set([...fromTsconfig, ...defaults]));
  if (bases.length === 0) return [];
  return expandAliasPathCandidates(bases);
}

/**
 * 从一行 import/export 语句中，根据点击的绑定名解析出 from 路径。
 *
 * 支持：
 *   import * as UserApi from '@/api/system/user'
 *   import { A, B as C } from '@/x'
 *   import Foo from '@/x'
 *   import Foo, { Bar } from '@/x'
 *   export { A } from '@/x'
 */
export function findImportSpecifierForBinding(line: string, bindingName: string): string | null {
  const name = bindingName.trim();
  if (!name || !line.trim()) return null;

  const fromMatch = line.match(/\bfrom\s*(['"])([^'"]+)\1/);
  if (!fromMatch) return null;
  const specifier = fromMatch[2]!.trim();
  if (!specifier) return null;

  // import * as Name from '...'
  const starAs = line.match(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\b/);
  if (starAs?.[1] === name) return specifier;

  // import Default from '...' 或 import Default, { ... } from '...'
  const defaultImport = line.match(
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{|\s+from\b)/,
  );
  if (defaultImport?.[1] === name) return specifier;

  // import { A, B as C } / export { A as B }
  const brace = line.match(/\{([^}]*)\}/);
  if (brace) {
    const parts = brace[1]!.split(",");
    for (const part of parts) {
      const seg = part.trim();
      if (!seg) continue;
      // `B as C` → 可点 B 或 C
      const asMatch = seg.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        if (asMatch[1] === name || asMatch[2] === name) return specifier;
        continue;
      }
      // `type Foo` / `typeof Bar`
      const typeMatch = seg.match(/^(?:type|typeof)\s+([A-Za-z_$][\w$]*)$/);
      if (typeMatch?.[1] === name) return specifier;
      if (seg === name) return specifier;
    }
  }

  return null;
}

function getExt(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (base.endsWith(".d.ts")) return "d.ts";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function normalizeRelative(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}
