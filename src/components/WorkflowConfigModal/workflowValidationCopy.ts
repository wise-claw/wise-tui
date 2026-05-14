export function getWorkflowValidationGroupTitle(code: string): string {
  if (code.includes("EDGE")) return "连线错误";
  if (code.includes("NODE")) return "节点错误";
  if (code.includes("START") || code.includes("APPROVAL")) return "流程结构错误";
  return "其他错误";
}

export function getWorkflowValidationSuggestion(code: string): string {
  const suggestions: Record<string, string> = {
    WF_GRAPH_INVALID_FORMAT: "请确认 graph 为对象结构，包含 nodes/edges 字段。",
    WF_GRAPH_NODES_INVALID: "请检查 nodes 是否为数组。",
    WF_GRAPH_NODES_EMPTY: "请至少添加一个开始节点和一个审批节点。",
    WF_GRAPH_NODE_ID_MISSING: "请为该节点填写唯一 id。",
    WF_GRAPH_NODE_ID_DUPLICATED: "请修改重复节点 id，保证每个节点 id 唯一。",
    WF_GRAPH_NODE_TYPE_MISSING: "请为该节点指定类型（start/task/approval/end）。",
    WF_GRAPH_EDGES_INVALID: "请检查 edges 是否为数组。",
    WF_GRAPH_EDGES_EMPTY: "请至少连接一条边，形成有效流程。",
    WF_GRAPH_EDGE_ID_MISSING: "请为该边填写唯一 id。",
    WF_GRAPH_EDGE_ID_DUPLICATED: "请修改重复边 id，保证每条边 id 唯一。",
    WF_GRAPH_EDGE_ENDPOINT_MISSING: "请补全边的 source 与 target。",
    WF_GRAPH_EDGE_SOURCE_NOT_FOUND: "请将该边连接到存在的源节点。",
    WF_GRAPH_EDGE_TARGET_NOT_FOUND: "请将该边连接到存在的目标节点。",
    WF_GRAPH_START_MISSING: "请添加一个 start 节点作为流程入口。",
    WF_GRAPH_START_DUPLICATED: "请只保留一个 start 节点。",
    WF_GRAPH_APPROVAL_INCOMING_MISSING: "请为审批节点添加至少一条入边。",
    WF_GRAPH_APPROVAL_OUTGOING_MISSING: "请为审批节点添加至少一条出边。",
  };
  return suggestions[code] ?? "请根据错误提示修正节点/边配置后重试发布。";
}
