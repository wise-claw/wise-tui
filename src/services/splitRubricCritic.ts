import { buildRubricRulesPromptSection } from "../constants/taskSplitRubric";

export interface SplitCriticIssue {
  ruleId: string;
  severity: "warning" | "error";
  message: string;
  riskIfUnchanged: string;
  blastRadius: string;
  userVisibleFailure: boolean;
  fixPriority: "P0" | "P1" | "P2";
}

export function buildSplitRubricCriticPrompt(params: {
  prdPath: string;
  splitPath: string | null;
  requirementsIndexPath: string | null;
}): string {
  const lines = [
    "你是任务拆分 Rubric 批评家。请只做预审，不修改任何文件。",
    "请输出 JSON（不要 markdown 包裹），结构如下：",
    "{ \"violations\": [ { \"ruleId\": \"rule-1\", \"severity\": \"warning|error\", \"message\": \"...\", \"riskIfUnchanged\": \"...\", \"blastRadius\": \"...\", \"userVisibleFailure\": true, \"fixPriority\": \"P0|P1|P2\" } ] }",
    "若无问题则输出：{ \"violations\": [] }",
    "",
    buildRubricRulesPromptSection(),
    "",
    "请阅读以下文件：",
    `@${params.prdPath}`,
    params.splitPath ? `@${params.splitPath}` : "",
    params.requirementsIndexPath ? `@${params.requirementsIndexPath}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function parseSplitRubricCriticOutput(raw: string): SplitCriticIssue[] {
  const text = raw.trim();
  if (!text) return [];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text;
  try {
    const parsed = JSON.parse(fenced) as { violations?: unknown[] };
    const list = parsed.violations ?? [];
    return list.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<SplitCriticIssue>;
      if (
        typeof candidate.ruleId !== "string"
        || (candidate.severity !== "warning" && candidate.severity !== "error")
        || typeof candidate.message !== "string"
      ) {
        return [];
      }
      const fixPriority = candidate.fixPriority === "P0" || candidate.fixPriority === "P1" || candidate.fixPriority === "P2"
        ? candidate.fixPriority
        : (candidate.severity === "error" ? "P0" : "P1");
      return [{
        ruleId: candidate.ruleId,
        severity: candidate.severity,
        message: candidate.message,
        riskIfUnchanged: typeof candidate.riskIfUnchanged === "string" ? candidate.riskIfUnchanged : "未提供",
        blastRadius: typeof candidate.blastRadius === "string" ? candidate.blastRadius : "unknown",
        userVisibleFailure: typeof candidate.userVisibleFailure === "boolean" ? candidate.userVisibleFailure : false,
        fixPriority,
      }];
    });
  } catch {
    return [];
  }
}
