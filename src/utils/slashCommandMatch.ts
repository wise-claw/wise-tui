/** 斜杠补全查询：支持 `plugin ins` 匹配 `plugin install`；`loom:` 匹配 `loom:init` 等命名空间命令。 */
export function slashCommandMatchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const normalized = label.trim().toLowerCase();
  if (normalized.startsWith(q)) return true;
  if (normalized.includes(q)) return true;

  if (q.includes(":")) {
    const [namespace, rest] = q.split(":", 2);
    if (namespace && rest === "" && normalized.startsWith(`${namespace}:`)) {
      return true;
    }
    if (namespace && rest && normalized.startsWith(`${namespace}:${rest}`)) {
      return true;
    }
  }

  const queryParts = q.split(/\s+/).filter(Boolean);
  if (queryParts.length <= 1) return false;

  const labelParts = normalized.split(/\s+/);
  let qi = 0;
  for (const part of labelParts) {
    if (qi >= queryParts.length) break;
    if (part.startsWith(queryParts[qi]!)) {
      qi += 1;
    }
  }
  return qi === queryParts.length;
}

export function shouldShowComposerPluginInstallTemplates(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return q.startsWith("plugin");
}

export function shouldShowComposerPluginInstalledTemplates(query: string): boolean {
  return shouldShowComposerPluginInstallTemplates(query);
}
