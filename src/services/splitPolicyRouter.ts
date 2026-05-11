export type SplitPolicyId = "feature_domain_first" | "user_journey_first" | "tech_layer_first";

interface SplitPolicyInputRequirement {
  id: string;
  text: string;
}

interface SplitPolicyInput {
  prdText: string;
  requirements: SplitPolicyInputRequirement[];
}

export interface SplitPolicyFeatures {
  [key: string]: number;
  requirementCount: number;
  headingCount: number;
  headingDensity: number;
  timelineKeywordCount: number;
  timelineKeywordRatio: number;
  technicalKeywordCount: number;
  technicalKeywordRatio: number;
  averageRequirementLength: number;
}

export interface SplitPolicyDecision {
  policyId: SplitPolicyId;
  policyFeatures: SplitPolicyFeatures;
  rationale: string[];
}

const TIMELINE_KEYWORDS = [
  "阶段",
  "里程碑",
  "排期",
  "计划",
  "上线",
  "发布",
  "迭代",
  "周期",
  "天",
  "周",
  "月",
  "deadline",
  "timeline",
  "milestone",
  "phase",
] as const;

const TECHNICAL_KEYWORDS = [
  "api",
  "sdk",
  "schema",
  "数据库",
  "数据表",
  "字段",
  "索引",
  "缓存",
  "队列",
  "并发",
  "鉴权",
  "权限",
  "接口",
  "模块",
  "微服务",
  "rpc",
  "grpc",
  "webhook",
] as const;

const HEADING_REGEXES = [/^#{1,6}\s+/gm, /^\d+(\.\d+)*[\.\)]\s+/gm, /^[（(]?[一二三四五六七八九十]+[)）\.\、]\s*/gm] as const;
const ALPHA_NUMERIC_WORD_REGEX = /[a-zA-Z0-9_]+/g;
const CJK_CHAR_REGEX = /[\u4e00-\u9fa5]/g;

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function countKeywordHits(text: string, keywords: readonly string[]): number {
  const normalized = normalizeText(text);
  let total = 0;
  for (const keyword of keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = normalized.match(new RegExp(escaped, "g"));
    total += matches?.length ?? 0;
  }
  return total;
}

function estimateTokenCount(text: string): number {
  const wordCount = text.match(ALPHA_NUMERIC_WORD_REGEX)?.length ?? 0;
  const cjkCount = text.match(CJK_CHAR_REGEX)?.length ?? 0;
  return wordCount + cjkCount;
}

function countHeadings(text: string): number {
  let total = 0;
  for (const regex of HEADING_REGEXES) {
    total += text.match(regex)?.length ?? 0;
  }
  return total;
}

function clampRatio(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(4));
}

function buildFeatures(input: SplitPolicyInput): SplitPolicyFeatures {
  const mergedRequirements = input.requirements.map((item) => item.text).join("\n");
  const allText = `${input.prdText}\n${mergedRequirements}`;
  const tokenCount = Math.max(estimateTokenCount(allText), 1);
  const timelineKeywordCount = countKeywordHits(allText, TIMELINE_KEYWORDS);
  const technicalKeywordCount = countKeywordHits(allText, TECHNICAL_KEYWORDS);
  const headingCount = countHeadings(input.prdText);
  const requirementCount = input.requirements.length;
  const requirementTotalLength = input.requirements.reduce((sum, item) => sum + item.text.trim().length, 0);
  const averageRequirementLength = requirementCount > 0 ? Math.round(requirementTotalLength / requirementCount) : 0;

  return {
    requirementCount,
    headingCount,
    headingDensity: clampRatio(headingCount / Math.max(requirementCount, 1)),
    timelineKeywordCount,
    timelineKeywordRatio: clampRatio(timelineKeywordCount / tokenCount),
    technicalKeywordCount,
    technicalKeywordRatio: clampRatio(technicalKeywordCount / tokenCount),
    averageRequirementLength,
  };
}

function decideByScore(features: SplitPolicyFeatures): SplitPolicyId {
  const journeyScore = features.timelineKeywordRatio * 100 + features.headingDensity * 12;
  const techLayerScore = features.technicalKeywordRatio * 100 + Math.min(features.averageRequirementLength / 30, 8);
  const featureDomainScore =
    features.requirementCount * 0.8 + (1 - Math.abs(features.timelineKeywordRatio - features.technicalKeywordRatio)) * 10;

  if (journeyScore >= techLayerScore && journeyScore >= featureDomainScore) {
    return "user_journey_first";
  }
  if (techLayerScore >= journeyScore && techLayerScore >= featureDomainScore) {
    return "tech_layer_first";
  }
  return "feature_domain_first";
}

function buildRationale(policyId: SplitPolicyId, features: SplitPolicyFeatures): string[] {
  if (policyId === "user_journey_first") {
    return [
      "检测到较强时序/里程碑信号，优先按用户路径拆分。",
      `timelineRatio=${features.timelineKeywordRatio}`,
      `headingDensity=${features.headingDensity}`,
    ];
  }
  if (policyId === "tech_layer_first") {
    return [
      "检测到技术实现信号更强，优先按技术层次拆分。",
      `techRatio=${features.technicalKeywordRatio}`,
      `avgReqLen=${features.averageRequirementLength}`,
    ];
  }
  return [
    "特征分布相对均衡，优先按功能域拆分。",
    `requirements=${features.requirementCount}`,
    `timelineRatio=${features.timelineKeywordRatio}`,
    `techRatio=${features.technicalKeywordRatio}`,
  ];
}

export function decideSplitPolicy(input: SplitPolicyInput): SplitPolicyDecision {
  const policyFeatures = buildFeatures(input);
  const policyId = decideByScore(policyFeatures);
  return {
    policyId,
    policyFeatures,
    rationale: buildRationale(policyId, policyFeatures),
  };
}
