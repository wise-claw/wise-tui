import type { MaterialItem } from "./workflowX6CanvasShared";

export interface WorkflowMaterialCategory {
  key: string;
  title: string;
  materialKeys: string[];
}

/** Dify 风格分组：流程控制 / 智能体 / 逻辑 / 变换 */
export const WORKFLOW_MATERIAL_CATEGORIES: WorkflowMaterialCategory[] = [
  {
    key: "flow",
    title: "流程控制",
    materialKeys: ["start", "end"],
  },
  {
    key: "agent",
    title: "智能体",
    materialKeys: ["employee", "gateway"],
  },
  {
    key: "logic",
    title: "逻辑",
    materialKeys: ["branch"],
  },
  {
    key: "transform",
    title: "变换",
    materialKeys: ["prompt", "knowledge", "code"],
  },
];

export const WORKFLOW_MATERIAL_CATEGORY_BY_KEY = Object.fromEntries(
  WORKFLOW_MATERIAL_CATEGORIES.flatMap((category) => category.materialKeys.map((key) => [key, category] as const)),
);

export function materialCategoryTitle(materialKey: string): string {
  return WORKFLOW_MATERIAL_CATEGORY_BY_KEY[materialKey]?.title ?? "其他";
}

export function isAgentMaterial(material: MaterialItem): boolean {
  return material.key === "employee" || material.key === "gateway";
}
