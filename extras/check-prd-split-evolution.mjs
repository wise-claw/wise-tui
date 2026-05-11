#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const wiseDir = path.join(repoRoot, ".wise");
const evolutionPath = path.join(wiseDir, "prd-split-evolution.jsonl");
const learningPath = path.join(wiseDir, "prd-split-learning-samples.jsonl");
const DEFAULT_POLICIES = ["feature_domain_first", "user_journey_first", "tech_layer_first"];

/**
 * 用法：
 * - node extras/check-prd-split-evolution.mjs
 * - node extras/check-prd-split-evolution.mjs --policies=feature_domain_first,user_journey_first --topk=5
 * - bun extras/check-prd-split-evolution.mjs --topk=10 --out=.wise/prd-split-policy-compare.json
 */
function parseArgs(argv) {
  const parsed = {
    policies: [...DEFAULT_POLICIES],
    topk: 10,
    out: path.join(wiseDir, "prd-split-policy-compare.json"),
  };
  for (const token of argv) {
    if (token.startsWith("--policies=")) {
      const raw = token.slice("--policies=".length);
      const list = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (list.length > 0) parsed.policies = Array.from(new Set(list));
      continue;
    }
    if (token.startsWith("--topk=")) {
      const value = Number(token.slice("--topk=".length));
      if (Number.isFinite(value) && value > 0) parsed.topk = Math.floor(value);
      continue;
    }
    if (token.startsWith("--out=")) {
      const rawOut = token.slice("--out=".length).trim();
      if (rawOut) parsed.out = path.isAbsolute(rawOut) ? rawOut : path.join(repoRoot, rawOut);
    }
  }
  return parsed;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

function countBy(arr, key) {
  const map = new Map();
  for (const item of arr) {
    const k = item?.[key] ?? "(unknown)";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function printSection(title) {
  process.stdout.write(`\n## ${title}\n`);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizePolicyId(sample) {
  return sample?.after?.context?.splitPolicyId ?? sample?.before?.context?.splitPolicyId ?? sample?.policyId ?? null;
}

function normalizePrdFingerprint(sample) {
  if (typeof sample?.prdFingerprint === "string" && sample.prdFingerprint.trim()) return sample.prdFingerprint.trim();
  const title = sample?.after?.source?.title ?? sample?.before?.source?.title ?? "(untitled)";
  const sourceRef = sample?.after?.source?.sourceRef ?? sample?.before?.source?.sourceRef ?? "";
  return `${title}::${sourceRef}`;
}

function detectValidationCompat(result) {
  const hardErrors = Array.isArray(result?.hardErrors)
    ? result.hardErrors
    : Array.isArray(result?.errors)
      ? result.errors
      : null;
  const softWarnings = Array.isArray(result?.softWarnings)
    ? result.softWarnings
    : Array.isArray(result?.warnings)
      ? result.warnings
      : null;
  if (hardErrors && softWarnings) {
    return { hardErrorsCount: hardErrors.length, softWarningsCount: softWarnings.length };
  }
  return null;
}

function collectGraphIssueCounts(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return { hard: 0, soft: 0 };
  const idSet = new Set(tasks.map((task) => task?.id).filter(Boolean));
  let hard = 0;
  let soft = 0;
  const adj = new Map();
  for (const task of tasks) {
    const id = task?.id;
    if (!id) continue;
    const deps = Array.isArray(task?.dependencies) ? task.dependencies.filter((dep) => typeof dep === "string") : [];
    const seen = new Set();
    for (const dep of deps) {
      if (!idSet.has(dep) || dep === id) hard += 1;
      if (seen.has(dep)) soft += 1;
      seen.add(dep);
    }
    adj.set(id, deps.filter((dep) => idSet.has(dep) && dep !== id));
  }
  const color = new Map();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  for (const id of idSet) color.set(id, WHITE);
  function visit(node) {
    color.set(node, GRAY);
    for (const dep of adj.get(node) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) return true;
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(node, BLACK);
    return false;
  }
  for (const id of idSet) {
    if (color.get(id) !== WHITE) continue;
    if (visit(id)) {
      hard += 1;
      break;
    }
  }
  return { hard, soft };
}

function deriveValidationFromSplit(splitResult) {
  const tasks = Array.isArray(splitResult?.tasks) ? splitResult.tasks : [];
  const compat = detectValidationCompat(splitResult);
  if (compat) return compat;
  const graph = collectGraphIssueCounts(tasks);
  let softWarningsCount = graph.soft;
  for (const task of tasks) {
    if (task?.size === "L") softWarningsCount += 1;
    if (!Array.isArray(task?.subtasks) || task.subtasks.length === 0) softWarningsCount += 1;
    if (!Array.isArray(task?.dod) || task.dod.length === 0) softWarningsCount += 1;
  }
  return { hardErrorsCount: graph.hard, softWarningsCount };
}

function computeRubricScore(hardErrorsCount, softWarningsCount) {
  return Math.max(0, 100 - hardErrorsCount * 20 - softWarningsCount * 5);
}

function aggregatePolicyComparison(samples, selectedPolicies) {
  const byPrd = new Map();
  for (const sample of samples) {
    const policyId = normalizePolicyId(sample);
    if (!policyId || !selectedPolicies.has(policyId)) continue;
    const prdFingerprint = normalizePrdFingerprint(sample);
    const split = sample?.after ?? sample?.before;
    const { hardErrorsCount, softWarningsCount } = deriveValidationFromSplit(split);
    const taskCount = Array.isArray(split?.tasks) ? split.tasks.length : 0;
    const rubricScore = computeRubricScore(hardErrorsCount, softWarningsCount);
    if (!byPrd.has(prdFingerprint)) byPrd.set(prdFingerprint, new Map());
    const byPolicy = byPrd.get(prdFingerprint);
    if (!byPolicy.has(policyId)) {
      byPolicy.set(policyId, {
        policyId,
        rubricScoreTotal: 0,
        hardErrorsTotal: 0,
        softWarningsTotal: 0,
        taskCountTotal: 0,
        sampleCount: 0,
      });
    }
    const acc = byPolicy.get(policyId);
    acc.rubricScoreTotal += rubricScore;
    acc.hardErrorsTotal += hardErrorsCount;
    acc.softWarningsTotal += softWarningsCount;
    acc.taskCountTotal += taskCount;
    acc.sampleCount += 1;
  }

  const comparedPrds = [];
  const leaderboardMap = new Map();
  for (const [prdFingerprint, policyMap] of byPrd.entries()) {
    const strategies = [];
    for (const stat of policyMap.values()) {
      const row = {
        policyId: stat.policyId,
        sampleCount: stat.sampleCount,
        rubricScore: Number((stat.rubricScoreTotal / stat.sampleCount).toFixed(2)),
        hardErrorsCount: Number((stat.hardErrorsTotal / stat.sampleCount).toFixed(2)),
        softWarningsCount: Number((stat.softWarningsTotal / stat.sampleCount).toFixed(2)),
        taskCount: Number((stat.taskCountTotal / stat.sampleCount).toFixed(2)),
      };
      strategies.push(row);
      if (!leaderboardMap.has(stat.policyId)) {
        leaderboardMap.set(stat.policyId, {
          policyId: stat.policyId,
          prdCount: 0,
          sampleCount: 0,
          rubricScoreTotal: 0,
          hardErrorsTotal: 0,
          softWarningsTotal: 0,
          taskCountTotal: 0,
        });
      }
      const agg = leaderboardMap.get(stat.policyId);
      agg.prdCount += 1;
      agg.sampleCount += stat.sampleCount;
      agg.rubricScoreTotal += stat.rubricScoreTotal;
      agg.hardErrorsTotal += stat.hardErrorsTotal;
      agg.softWarningsTotal += stat.softWarningsTotal;
      agg.taskCountTotal += stat.taskCountTotal;
    }
    if (strategies.length >= 2) {
      comparedPrds.push({
        prdFingerprint,
        strategies: strategies.sort((a, b) => b.rubricScore - a.rubricScore),
      });
    }
  }

  const leaderboard = Array.from(leaderboardMap.values())
    .map((row) => ({
      policyId: row.policyId,
      prdCount: row.prdCount,
      sampleCount: row.sampleCount,
      rubricScore: Number((row.rubricScoreTotal / row.sampleCount).toFixed(2)),
      hardErrorsCount: Number((row.hardErrorsTotal / row.sampleCount).toFixed(2)),
      softWarningsCount: Number((row.softWarningsTotal / row.sampleCount).toFixed(2)),
      taskCount: Number((row.taskCountTotal / row.sampleCount).toFixed(2)),
    }))
    .sort((a, b) => b.rubricScore - a.rubricScore);

  return { comparedPrds, leaderboard };
}

const args = parseArgs(process.argv.slice(2));
process.stdout.write("# PRD 拆分闭环快速验收（多策略对比）\n");
process.stdout.write(`仓库：${repoRoot}\n`);
process.stdout.write(`时间：${new Date().toISOString()}\n`);
process.stdout.write(`策略：${args.policies.join(", ")}\n`);
process.stdout.write(`TopK：${args.topk}\n`);

if (!fs.existsSync(wiseDir)) {
  printSection("结论");
  process.stdout.write("- 未发现 `.wise/` 目录；请先在应用中执行一次“用 Claude 深化”。\n");
  process.exit(0);
}

const evolutionRows = readJsonl(evolutionPath);
const learningRows = readJsonl(learningPath);

printSection("文件状态");
process.stdout.write(`- prd-split-evolution.jsonl：${fs.existsSync(evolutionPath) ? "存在" : "不存在"}\n`);
process.stdout.write(`- prd-split-learning-samples.jsonl：${fs.existsSync(learningPath) ? "存在" : "不存在"}\n`);

printSection("进化日志摘要");
process.stdout.write(`- 总记录数：${evolutionRows.length}\n`);
const byKind = countBy(evolutionRows, "kind");
if (byKind.length === 0) {
  process.stdout.write("- 无可解析记录\n");
} else {
  for (const [kind, count] of byKind) {
    process.stdout.write(`- ${kind}: ${count}\n`);
  }
}

const tagCounts = new Map();
for (const row of evolutionRows) {
  for (const tag of row?.feedbackTags ?? []) {
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
}
const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
if (topTags.length > 0) {
  process.stdout.write("- Top 反馈标签：\n");
  for (const [tag, count] of topTags) {
    process.stdout.write(`  - ${tag}: ${count}\n`);
  }
}

printSection("学习样本摘要");
process.stdout.write(`- 样本数：${learningRows.length}\n`);
const fingerprints = new Set(learningRows.map((r) => r?.prdFingerprint).filter(Boolean));
process.stdout.write(`- PRD 指纹数：${fingerprints.size}\n`);
const withBeforeAfter = learningRows.filter((r) => r?.before && r?.after).length;
process.stdout.write(`- 含 before/after 样本：${withBeforeAfter}\n`);

const selectedPolicies = new Set(args.policies);
const policyComparison = aggregatePolicyComparison(learningRows, selectedPolicies);
const topComparedPrds = policyComparison.comparedPrds
  .sort((a, b) => {
    const aBest = a.strategies[0]?.rubricScore ?? -1;
    const bBest = b.strategies[0]?.rubricScore ?? -1;
    return bBest - aBest;
  })
  .slice(0, args.topk);

printSection("多策略对比结果（同 PRD）");
if (topComparedPrds.length === 0) {
  process.stdout.write("- 没有发现同 PRD 下至少 2 个策略的样本，无法做横向比较。\n");
} else {
  process.stdout.write(`- 可比较 PRD 数：${policyComparison.comparedPrds.length}\n`);
  for (const item of topComparedPrds) {
    process.stdout.write(`- ${item.prdFingerprint}\n`);
    for (const strategy of item.strategies) {
      process.stdout.write(
        `  - ${strategy.policyId}: rubric=${strategy.rubricScore}, hardErrors=${strategy.hardErrorsCount}, softWarnings=${strategy.softWarningsCount}, tasks=${strategy.taskCount}, samples=${strategy.sampleCount}\n`,
      );
    }
  }
}

printSection("策略总榜");
if (policyComparison.leaderboard.length === 0) {
  process.stdout.write("- 当前策略样本为空。\n");
} else {
  for (const row of policyComparison.leaderboard) {
    process.stdout.write(
      `- ${row.policyId}: rubric=${row.rubricScore}, hardErrors=${row.hardErrorsCount}, softWarnings=${row.softWarningsCount}, tasks=${row.taskCount}, prds=${row.prdCount}, samples=${row.sampleCount}\n`,
    );
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  input: {
    evolutionPath,
    learningPath,
  },
  params: {
    policies: args.policies,
    topk: args.topk,
  },
  summary: {
    evolutionRows: evolutionRows.length,
    learningRows: learningRows.length,
    learningPrdFingerprintCount: fingerprints.size,
    learningWithBeforeAfterCount: withBeforeAfter,
    comparablePrdCount: policyComparison.comparedPrds.length,
  },
  leaderboard: policyComparison.leaderboard,
  comparedPrds: topComparedPrds,
};
ensureDir(args.out);
fs.writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");
printSection("报告文件");
process.stdout.write(`- 已写入：${args.out}\n`);

printSection("建议");
if (evolutionRows.length === 0) {
  process.stdout.write("- 先执行 1-2 次深化，生成进化日志后再进行提示词优化。\n");
}
if (learningRows.length < 3) {
  process.stdout.write("- 建议累计至少 3 条前后样本，再观察优化模板效果。\n");
}
if (evolutionRows.length > 0 && learningRows.length > 0) {
  process.stdout.write("- 当前已具备闭环数据基础，可继续迭代提示词模板。\n");
}
