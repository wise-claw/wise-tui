import type {
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphNodeData,
  WorkflowStageOutcomeCriterion,
} from "../types";
import type { WorkflowLoopFrame } from "../types/workflowLoop";
import { normalizeWorkflowStageOutcomeCriteria } from "../utils/workflowStageOutcomeCriteria";
import { applyWorkflowVariableSubstitution, normalizeWorkflowVariables, workflowVariablesToRecord } from "../utils/workflowVariables";
import { formatPassthroughBlockForNode, isPassthroughGraphNodeType } from "./workflowPassthroughBlocks";
import type { AcceptanceDecision } from "./workflow/acceptanceVerdict";
import { inferAcceptanceDecisionFromOutput, WORKFLOW_ACCEPTANCE_VERDICT_KEY } from "./workflow/acceptanceVerdict";
import {
  evaluateBranchConditions,
  normalizeBranchConditions,
  type BranchEvaluationContext,
} from "./workflowBranchEvaluation";
import {
  createLoopFrame,
  findLoopBodyEdge,
  findLoopNextEdge,
  isLoopBackEdge,
  mergeLoopVariablesIntoContext,
  shouldExitLoop,
} from "./workflowLoop";

export type { WorkflowLoopFrame } from "../types/workflowLoop";
export { WORKFLOW_ACCEPTANCE_VERDICT_KEY, inferAcceptanceDecisionFromOutput } from "./workflow/acceptanceVerdict";

export interface WorkflowGraphRuntimeState {
  currentNodeId: string;
  lastNodeId?: string;
  lastOutput?: string;
  trace: string[];
  loopStack?: WorkflowLoopFrame[];
}

export interface WorkflowNodeDispatch {
  nodeId: string;
  nodeType: WorkflowGraphNode["type"];
  employeeId?: string;
  employeeName: string;
  input: string;
}

export interface WorkflowAdvanceResult {
  state: WorkflowGraphRuntimeState;
  dispatch?: WorkflowNodeDispatch;
  completed: boolean;
}

export function workflowVariablesFromGraph(
  graph: WorkflowGraph | null | undefined,
  loopStack?: WorkflowLoopFrame[],
): Record<string, string> {
  if (!graph) return {};
  const start = graph.nodes.find((node) => node.type === "start");
  const base = start ? workflowVariablesToRecord(normalizeWorkflowVariables(start.data.workflowVariables)) : {};
  return mergeLoopVariablesIntoContext(graph, loopStack, base);
}

function applyGraphVariables(
  text: string,
  graph: WorkflowGraph | null | undefined,
  loopStack?: WorkflowLoopFrame[],
): string {
  const vars = workflowVariablesFromGraph(graph, loopStack);
  if (Object.keys(vars).length === 0) return text;
  return applyWorkflowVariableSubstitution(text, vars);
}

function nodeById(graph: WorkflowGraph, nodeId: string): WorkflowGraphNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`WF_NODE_NOT_FOUND:${nodeId}`);
  }
  return node;
}

function outgoingEdges(graph: WorkflowGraph, sourceId: string): WorkflowGraphEdge[] {
  return graph.edges.filter((edge) => edge.source === sourceId);
}

function selectAcceptanceEdge(edges: WorkflowGraphEdge[], decision: AcceptanceDecision): WorkflowGraphEdge {
  const expectedHandle = decision === "pass" ? "if" : "else";
  const byHandle = edges.find((edge) => edge.sourceHandle === expectedHandle);
  if (byHandle) {
    return byHandle;
  }
  const fallbackLabel = decision === "pass" ? "通过" : "驳回";
  const byLabel = edges.find((edge) => typeof edge.label === "string" && edge.label.includes(fallbackLabel));
  if (byLabel) {
    return byLabel;
  }
  throw new Error(`WF_ACCEPTANCE_EDGE_NOT_FOUND:${decision}`);
}

/** 阶段任务依据引用：`源节点id#成果索引`（id 内不含 `#`） */
export const STAGE_TASK_BASIS_REF_SEPARATOR = "#" as const;

export function parseStageTaskBasisRef(ref: string): { sourceNodeId: string; index: number } | null {
  const trimmed = ref.trim();
  const i = trimmed.lastIndexOf(STAGE_TASK_BASIS_REF_SEPARATOR);
  if (i <= 0) return null;
  const sourceNodeId = trimmed.slice(0, i);
  const index = Number(trimmed.slice(i + 1));
  if (!sourceNodeId || !Number.isInteger(index) || index < 0) return null;
  return { sourceNodeId, index };
}

/** 从节点数据读取多选依据；兼容旧版单字段 `stageTaskBasisRef`。 */
export function normalizeStageTaskBasisRefsFromNodeData(data: WorkflowGraphNodeData): string[] {
  const fromArray = Array.isArray(data.stageTaskBasisRefs)
    ? data.stageTaskBasisRefs.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter(Boolean)
    : [];
  const dedup = [...new Set(fromArray)];
  if (dedup.length > 0) return dedup;
  const legacy = typeof data.stageTaskBasisRef === "string" ? data.stageTaskBasisRef.trim() : "";
  return legacy ? [legacy] : [];
}

function formatSingleStageTaskBasisBlock(ref: string, graph: WorkflowGraph): string {
  const parsed = parseStageTaskBasisRef(ref);
  if (!parsed) return "";
  const sourceNode = graph.nodes.find((n) => n.id === parsed.sourceNodeId);
  if (!sourceNode) return "";
  const criteria = normalizeWorkflowStageOutcomeCriteria(sourceNode.data.stageSuccessCriteria);
  const c = criteria[parsed.index];
  if (!c) return "";
  const stageTitle = (sourceNode.data.label || sourceNode.id).trim() || sourceNode.id;
  const name = c.name.trim() || `成果 ${parsed.index + 1}`;
  const headline = `【阶段任务依据】成果「${name}」`;
  const lines: string[] = [
    headline,
    `（本任务据以对照的成果标准来自流程节点「${stageTitle}」。）`,
  ];
  const req = c.requirement.trim();
  if (req) {
    lines.push("", "**所选成果标准原文：**", "", req);
  }
  return lines.join("\n");
}

/** 将所选团队内成果标准格式化为派发前缀（置于阶段任务与用户补充要求之前）；支持多选。 */
export function formatStageTaskBasisBlock(nextNode: WorkflowGraphNode, graph: WorkflowGraph): string {
  const refs = normalizeStageTaskBasisRefsFromNodeData(nextNode.data);
  if (refs.length === 0) return "";
  const parts = refs.map((ref) => formatSingleStageTaskBasisBlock(ref, graph)).filter((block) => block.length > 0);
  if (parts.length === 0) return "";
  return parts.join("\n\n────────────────\n\n");
}

function composeNodeInput(baseInput: string, prompt?: string): string {
  const trimmedPrompt = prompt?.trim();
  if (!trimmedPrompt) {
    return baseInput;
  }
  if (!baseInput.trim()) {
    return trimmedPrompt;
  }
  return `${baseInput}\n\n补充要求：${trimmedPrompt}`;
}

function isAcceptanceEnabledForEmployeeNode(nextNode: WorkflowGraphNode): boolean {
  return nextNode.data.conditionElsePrompt?.trim() === "acceptance_enabled";
}

export function resolveWorkflowDispatchNodeType(nextNode: WorkflowGraphNode): WorkflowGraphNode["type"] {
  if (nextNode.type !== "approval") {
    return nextNode.type;
  }
  return isAcceptanceEnabledForEmployeeNode(nextNode) ? "approval" : "task";
}

function getAcceptanceCriteriaPrompt(nextNode: WorkflowGraphNode): string | undefined {
  const raw = nextNode.data.conditionIfPrompt?.trim();
  if (!raw) return undefined;
  if (raw === "rollback" || raw === "acceptance_enabled") return undefined;
  return raw;
}

/** 阶段成果报告 JSON 根键，与派发提示中的示例一致 */
export const WORKFLOW_STAGE_SUCCESS_REPORT_KEY = "workflowStageSuccessReport" as const;

function getStageOutcomeCriteriaList(nextNode: WorkflowGraphNode): WorkflowStageOutcomeCriterion[] {
  return normalizeWorkflowStageOutcomeCriteria(nextNode.data.stageSuccessCriteria);
}

function appendStageSuccessDispatchInstructions(lines: string[], criteria: WorkflowStageOutcomeCriterion[]): void {
  if (criteria.length === 0) return;
  lines.push(
    "",
    "【本阶段成果标准（强约束）】",
    "你须在完成本阶段任务时**逐项对照**以下各条成果（含名称与要求）；未完成前不得声称阶段已完成。",
  );
  criteria.forEach((c, index) => {
    const n = index + 1;
    const nameLine = c.name.trim() ? `**名称：** ${c.name.trim()}` : `**名称：** （未命名，对应成果标准 ${n}）`;
    lines.push("", `--- 成果标准 ${n} ---`, nameLine, "", "**要求（Markdown）：**", "", c.requirement.trim());
  });
  lines.push(
    "",
    "【机器可读·阶段成果报告·必填】",
    "在本轮交付的回复**末尾**输出**一段** Markdown JSON 代码块，且其中 JSON 必须可被 `JSON.parse` 解析。",
    "结构示例：",
    "```json",
    `{`,
    `  "${WORKFLOW_STAGE_SUCCESS_REPORT_KEY}": {`,
    `    "version": 1,`,
    `    "criteria": [`,
    `      { "index": 0, "satisfied": true, "evidenceMarkdown": "说明（可为 Markdown 文本）" }`,
    `    ],`,
    `    "allSatisfied": true`,
    `  }`,
    `}`,
    "```",
    "要求：",
    `- "${WORKFLOW_STAGE_SUCCESS_REPORT_KEY}".criteria 数组长度必须等于上述成果标准条数（${criteria.length}），且 index 须为 0..${criteria.length - 1} 各出现一次；`,
    `- satisfied 表示该条标准是否已满足；evidenceMarkdown 简要给出依据；`,
    `- allSatisfied 须与 criteria 中每条 satisfied 的合取一致（全部为 true 时方为 true）；`,
    "- 若出现多段 JSON 代码块，阶段成果报告以**最后一次**出现的、含上述键名且可解析的代码块为准；",
    "- 若本消息同时要求「上阶段验收」结论，请在阶段成果 JSON 代码块**之后**再单独输出一段验收用的 ```json 代码块（含 workflowAcceptanceVerdict），避免混在同一 JSON 对象中导致解析歧义。",
    "- 代码块外可写任意说明；自动化侧将阶段成果报告与验收结论分别解析。",
  );
}

/** 组装发往员工节点的完整输入（验收节点附带通过/驳回说明与结论格式要求） */
export function composeDispatchInput(
  nextNode: WorkflowGraphNode,
  baseInput: string,
  graph?: WorkflowGraph | null,
  loopStack?: WorkflowLoopFrame[],
): string {
  const base = composeNodeInput(baseInput, nextNode.data.employeePrompt);
  const basisBlock = graph ? formatStageTaskBasisBlock(nextNode, graph) : "";
  const withBasis = basisBlock ? `${basisBlock}\n\n${base}` : base;
  if (nextNode.type !== "approval") {
    return applyGraphVariables(withBasis, graph, loopStack);
  }

  const stageCriteria = getStageOutcomeCriteriaList(nextNode);
  const acceptanceEnabled = isAcceptanceEnabledForEmployeeNode(nextNode);

  if (!acceptanceEnabled && stageCriteria.length === 0) {
    return withBasis;
  }

  const lines: string[] = [withBasis];
  appendStageSuccessDispatchInstructions(lines, stageCriteria);

  if (acceptanceEnabled) {
    const criteria = getAcceptanceCriteriaPrompt(nextNode);
    if (criteria) {
      lines.push("", "【上阶段成果验收评判标准（强约束）】", criteria);
      lines.push(
        "",
        "你必须严格按上述评判标准衡量上阶段产出；若标准与正文分析冲突，以评判标准为准。",
        "自动化流程不会依据全文自然语言做裁决，只读取你在回复**末尾**给出的结构化 JSON。",
      );
    } else {
      lines.push("", "自动化流程只读取你在回复**末尾**给出的结构化 JSON，不解析全文作为验收结论。");
    }
    lines.push(
      "",
      "【机器可读结论·验收·必填】",
      "在回复最后（或在阶段成果报告 JSON 代码块之后）输出**一段** Markdown JSON 代码块，且其中 JSON 必须可被 `JSON.parse` 解析，例如：",
      "```json",
      `{"${WORKFLOW_ACCEPTANCE_VERDICT_KEY}":"approve","rationale":"可选，一句话"}`,
      "```",
      `其中 "${WORKFLOW_ACCEPTANCE_VERDICT_KEY}" 只能为英文小写 approve 或 reject（须与评判标准一致）；同一对象内也可写作不带引号的 approve / reject。`,
      "亦允许使用键「验收结论」且值为「通过」或「驳回」。若出现多段 JSON 代码块，以最后一次出现的、可解析的代码块为准。",
      "可选在同一 JSON 对象内附带 `schemaVersion`（整数≥1）、`taskId`、`nodeId`（须与当前团队任务 id 及本验收节点 id **完全一致**）；若填写且不一致，系统将不采纳该 JSON 作为机器可读验收结论（仍可能按其它规则推断，见实现说明）。",
      "你可以在代码块之外撰写任意分析说明；流程侧**优先**根据上述 JSON（含 schema 门闸）决定通过或驳回。",
    );
  }

  return applyGraphVariables(lines.join("\n"), graph, loopStack);
}

export function createWorkflowRuntimeState(graph: WorkflowGraph): WorkflowGraphRuntimeState {
  const startNode = graph.nodes.find((node) => node.type === "start");
  if (!startNode) {
    throw new Error("WF_START_NODE_MISSING");
  }
  return {
    currentNodeId: startNode.id,
    trace: [startNode.id],
  };
}

function selectBranchEdge(
  edges: WorkflowGraphEdge[],
  branchNode: WorkflowGraphNode,
  ctx: BranchEvaluationContext,
): WorkflowGraphEdge {
  const conditions = normalizeBranchConditions(branchNode.data.branchConditions);
  const matched = evaluateBranchConditions(conditions, ctx);
  const byPort = edges.find((edge) => edge.sourceHandle === matched.portId);
  if (byPort) return byPort;
  const byLabel = edges.find((edge) => typeof edge.label === "string" && edge.label.trim() === matched.label.trim());
  if (byLabel) return byLabel;
  throw new Error(`WF_BRANCH_EDGE_NOT_FOUND:${matched.portId}`);
}

function buildBranchEvaluationContext(
  graph: WorkflowGraph,
  params: {
    lastOutput?: string;
    acceptanceDecision?: AcceptanceDecision;
    taskContent?: string;
    loopStack?: WorkflowLoopFrame[];
  },
): BranchEvaluationContext {
  return {
    variables: workflowVariablesFromGraph(graph, params.loopStack),
    taskContent: params.taskContent,
    lastOutput: params.lastOutput,
    acceptanceDecision: params.acceptanceDecision,
  };
}

function selectOutgoingEdge(
  graph: WorkflowGraph,
  fromNode: WorkflowGraphNode,
  acceptanceDecision: AcceptanceDecision | undefined,
  lastOutput?: string,
  loopStack?: WorkflowLoopFrame[],
): WorkflowGraphEdge {
  const edges = outgoingEdges(graph, fromNode.id);
  if (edges.length === 0) {
    throw new Error(`WF_NO_OUTGOING_EDGE:${fromNode.id}`);
  }
  if (fromNode.type === "approval") {
    const acceptanceRequired = isAcceptanceEnabledForEmployeeNode(fromNode);
    if (acceptanceRequired) {
      if (!acceptanceDecision) {
        throw new Error("WF_ACCEPTANCE_DECISION_REQUIRED");
      }
      return selectAcceptanceEdge(edges, acceptanceDecision);
    }
    return edges[0];
  }
  if (fromNode.type === "branch") {
    const ctx = buildBranchEvaluationContext(graph, { acceptanceDecision, lastOutput, loopStack });
    return selectBranchEdge(edges, fromNode, ctx);
  }
  return edges[0];
}

function resolveLoopTransition(params: {
  graph: WorkflowGraph;
  state: WorkflowGraphRuntimeState;
  selectedEdge: WorkflowGraphEdge;
  lastOutput?: string;
  acceptanceDecision?: AcceptanceDecision;
  taskContent?: string;
}): { nextNode: WorkflowGraphNode; loopStack: WorkflowLoopFrame[] } {
  let loopStack = [...(params.state.loopStack ?? [])];
  let nextNode = nodeById(params.graph, params.selectedEdge.target);

  if (nextNode.type === "loop" && isLoopBackEdge(params.selectedEdge, nextNode.id)) {
    const loopNode = nextNode;
    const frameIndex = loopStack.findIndex((frame) => frame.loopNodeId === loopNode.id);
    if (frameIndex < 0) {
      throw new Error(`WF_LOOP_FRAME_MISSING:${loopNode.id}`);
    }
    const frame = loopStack[frameIndex];
    const ctx = buildBranchEvaluationContext(params.graph, {
      lastOutput: params.lastOutput,
      acceptanceDecision: params.acceptanceDecision,
      taskContent: params.taskContent,
      loopStack,
    });
    if (shouldExitLoop({ loopNode, iteration: frame.iteration, ctx })) {
      loopStack = loopStack.filter((_, index) => index !== frameIndex);
      const nextEdge = findLoopNextEdge(params.graph, loopNode.id);
      return { nextNode: nodeById(params.graph, nextEdge.target), loopStack };
    }
    const nextFrame = { ...frame, iteration: frame.iteration + 1 };
    loopStack = loopStack.map((item, index) => (index === frameIndex ? nextFrame : item));
    const bodyEdge = findLoopBodyEdge(params.graph, loopNode.id);
    return { nextNode: nodeById(params.graph, bodyEdge.target), loopStack };
  }

  if (nextNode.type === "loop") {
    const loopNode = nextNode;
    const existingFrameIndex = loopStack.findIndex((frame) => frame.loopNodeId === loopNode.id);
    if (existingFrameIndex >= 0) {
      const frame = loopStack[existingFrameIndex];
      const ctx = buildBranchEvaluationContext(params.graph, {
        lastOutput: params.lastOutput,
        acceptanceDecision: params.acceptanceDecision,
        taskContent: params.taskContent,
        loopStack,
      });
      if (shouldExitLoop({ loopNode, iteration: frame.iteration, ctx })) {
        loopStack = loopStack.filter((_, index) => index !== existingFrameIndex);
        const nextEdge = findLoopNextEdge(params.graph, loopNode.id);
        return { nextNode: nodeById(params.graph, nextEdge.target), loopStack };
      }
      const nextFrame = { ...frame, iteration: frame.iteration + 1 };
      loopStack = loopStack.map((item, index) => (index === existingFrameIndex ? nextFrame : item));
      const bodyEdge = findLoopBodyEdge(params.graph, loopNode.id);
      return { nextNode: nodeById(params.graph, bodyEdge.target), loopStack };
    }
    loopStack = [...loopStack, createLoopFrame(loopNode)];
    const bodyEdge = findLoopBodyEdge(params.graph, loopNode.id);
    return { nextNode: nodeById(params.graph, bodyEdge.target), loopStack };
  }

  return { nextNode, loopStack };
}

function resolveDispatchTarget(params: {
  graph: WorkflowGraph;
  startNode: WorkflowGraphNode;
  acceptanceDecision?: AcceptanceDecision;
  lastOutput?: string;
  taskContent?: string;
  loopStack?: WorkflowLoopFrame[];
}): { dispatchNode: WorkflowGraphNode; prefixBlocks: string[]; traceNodeIds: string[]; loopStack: WorkflowLoopFrame[] } {
  const { graph, startNode, acceptanceDecision, lastOutput, taskContent } = params;
  let activeLoopStack = [...(params.loopStack ?? [])];
  let cursor = startNode;
  const prefixBlocks: string[] = [];
  const traceNodeIds: string[] = [];
  let branchDecision = acceptanceDecision;

  while (true) {
    traceNodeIds.push(cursor.id);
    if (cursor.type === "end") {
      return { dispatchNode: cursor, prefixBlocks, traceNodeIds, loopStack: activeLoopStack };
    }
    if (cursor.type === "loop") {
      if (!activeLoopStack.some((frame) => frame.loopNodeId === cursor.id)) {
        activeLoopStack = [...activeLoopStack, createLoopFrame(cursor)];
      }
      const bodyEdge = findLoopBodyEdge(graph, cursor.id);
      cursor = nodeById(graph, bodyEdge.target);
      continue;
    }
    if (isPassthroughGraphNodeType(cursor.type)) {
      const block = formatPassthroughBlockForNode(cursor, graph, taskContent, activeLoopStack);
      if (block.trim()) {
        prefixBlocks.push(applyGraphVariables(block, graph, activeLoopStack));
      }
      const out = outgoingEdges(graph, cursor.id);
      if (out.length === 0) {
        throw new Error(`WF_NO_OUTGOING_EDGE:${cursor.id}`);
      }
      cursor = nodeById(graph, out[0].target);
      continue;
    }
    if (cursor.type === "branch") {
      const ctx = buildBranchEvaluationContext(graph, {
        acceptanceDecision: branchDecision,
        lastOutput,
        loopStack: activeLoopStack,
      });
      const out = outgoingEdges(graph, cursor.id);
      const selected = selectBranchEdge(out, cursor, ctx);
      cursor = nodeById(graph, selected.target);
      branchDecision = undefined;
      continue;
    }
    if (cursor.type === "task" || cursor.type === "approval") {
      return { dispatchNode: cursor, prefixBlocks, traceNodeIds, loopStack: activeLoopStack };
    }
    throw new Error(`WF_UNSUPPORTED_NODE:${cursor.id}`);
  }
}

export function advanceWorkflowGraph(params: {
  graph: WorkflowGraph;
  state: WorkflowGraphRuntimeState;
  startContent: string;
  lastOutput?: string;
  acceptanceDecision?: AcceptanceDecision;
}): WorkflowAdvanceResult {
  const { graph, state, startContent, lastOutput, acceptanceDecision } = params;
  const currentNode = nodeById(graph, state.currentNodeId);

  if (currentNode.type === "end") {
    return { state, completed: true };
  }

  let effectiveDecision = acceptanceDecision;
  const baseInput = applyGraphVariables(startContent.trim(), graph, state.loopStack);
  const selectedEdge = selectOutgoingEdge(graph, currentNode, effectiveDecision, lastOutput, state.loopStack);
  const loopTransition = resolveLoopTransition({
    graph,
    state,
    selectedEdge,
    lastOutput,
    acceptanceDecision: effectiveDecision,
    taskContent: baseInput,
  });
  let nextNode = loopTransition.nextNode;
  const activeLoopStack = loopTransition.loopStack;

  let branchDecisionForTraversal = effectiveDecision;
  if (nextNode.type === "branch" && !branchDecisionForTraversal && lastOutput?.trim()) {
    const inferred = inferAcceptanceDecisionFromOutput(lastOutput);
    if (inferred) {
      branchDecisionForTraversal = inferred;
    }
  }

  const resolved = resolveDispatchTarget({
    graph,
    startNode: nextNode,
    acceptanceDecision: branchDecisionForTraversal,
    lastOutput,
    taskContent: baseInput,
    loopStack: activeLoopStack,
  });
  const dispatchNode = resolved.dispatchNode;
  const mergedLoopStack = resolved.loopStack;
  const uniqueTrace = [...state.trace];
  for (const id of resolved.traceNodeIds) {
    if (!uniqueTrace.includes(id)) {
      uniqueTrace.push(id);
    }
  }
  const topLoopFrame = mergedLoopStack[mergedLoopStack.length - 1];
  if (topLoopFrame && !uniqueTrace.includes(topLoopFrame.loopNodeId)) {
    uniqueTrace.push(topLoopFrame.loopNodeId);
  }

  const nextState: WorkflowGraphRuntimeState = {
    currentNodeId: dispatchNode.id,
    lastNodeId: currentNode.id,
    lastOutput: lastOutput ?? state.lastOutput,
    trace: uniqueTrace,
    loopStack: mergedLoopStack.length > 0 ? mergedLoopStack : undefined,
  };

  if (dispatchNode.type === "end") {
    return { state: nextState, completed: true };
  }

  const composed = composeDispatchInput(dispatchNode, baseInput, graph, mergedLoopStack);
  const mergedInput =
    resolved.prefixBlocks.length > 0 ? `${resolved.prefixBlocks.join("\n\n")}\n\n${composed}` : composed;

  const dispatch: WorkflowNodeDispatch = {
    nodeId: dispatchNode.id,
    nodeType: resolveWorkflowDispatchNodeType(dispatchNode),
    employeeId: dispatchNode.data.employeeId,
    employeeName: dispatchNode.data.label,
    input: mergedInput,
  };

  return {
    state: nextState,
    dispatch,
    completed: false,
  };
}
