import type { MyExtensionKind } from "../types/myExtension";

const KIND_LABEL_CN: Record<MyExtensionKind, string> = {
  package: "扩展包",
  mcp: "MCP",
  skill: "技能",
  plugin: "插件",
  hook: "Hooks",
  script: "脚本",
};

/** 与后端 `default_capture_name` 对齐，用作录入扩展库时的默认名称。 */
export function defaultExtensionLibraryCaptureName(relativePath: string): string {
  const normalized = relativePath.trim().replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";
  if (base === "settings.json") return "project-hooks";
  if (base === "settings.local.json") return "local-hooks";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || "extension";
}

export function extensionKindLabelCn(kind: MyExtensionKind): string {
  return KIND_LABEL_CN[kind] ?? kind;
}
