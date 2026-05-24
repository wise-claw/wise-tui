use crate::wise_db;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowGraphItem {
    workflow_id: String,
    version: i64,
    graph: serde_json::Value,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowGraphValidationError {
    code: String,
    message: String,
    node_id: Option<String>,
    edge_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowGraphValidationResult {
    ok: bool,
    errors: Vec<WorkflowGraphValidationError>,
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub(crate) fn get_workflow_graph(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
) -> Result<Option<WorkflowGraphItem>, String> {
    let row = db.get_workflow_graph(workflow_id.trim())?;
    let Some(graph_row) = row else {
        return Ok(None);
    };
    let graph: serde_json::Value = serde_json::from_str(&graph_row.graph_json)
        .map_err(|e| format!("解析 workflow graph 失败: {}", e))?;
    Ok(Some(WorkflowGraphItem {
        workflow_id: graph_row.workflow_id,
        version: graph_row.version,
        graph,
        status: graph_row.status,
        created_at: graph_row.created_at,
        updated_at: graph_row.updated_at,
    }))
}

#[tauri::command]
pub(crate) fn save_workflow_graph(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
    graph: serde_json::Value,
    version: Option<i64>,
    status: Option<String>,
) -> Result<WorkflowGraphItem, String> {
    let workflow_id_value = workflow_id.trim();
    if workflow_id_value.is_empty() {
        return Err("workflowId 不能为空".to_string());
    }
    let validation = validate_workflow_graph(graph.clone())?;
    if !validation.ok {
        let messages = validation
            .errors
            .iter()
            .map(|item| item.message.clone())
            .collect::<Vec<String>>()
            .join("; ");
        return Err(format!("workflow graph 校验失败: {}", messages));
    }
    let graph_json =
        serde_json::to_string(&graph).map_err(|e| format!("序列化 workflow graph 失败: {}", e))?;
    let version_value = version.unwrap_or(1).max(1);
    let status_value = status
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "draft".to_string());
    let now_ms = unix_now_ms();
    db.upsert_workflow_graph(
        workflow_id_value,
        version_value,
        &graph_json,
        &status_value,
        now_ms,
    )?;
    get_workflow_graph(db, workflow_id_value.to_string())?
        .ok_or_else(|| "保存后读取 workflow graph 失败".to_string())
}

#[tauri::command]
pub(crate) fn validate_workflow_graph(
    graph: serde_json::Value,
) -> Result<WorkflowGraphValidationResult, String> {
    let mut errors = Vec::new();
    let Some(graph_obj) = graph.as_object() else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_INVALID_FORMAT".to_string(),
            message: "graph 必须是对象".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    let Some(nodes) = graph_obj.get("nodes").and_then(|v| v.as_array()) else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODES_INVALID".to_string(),
            message: "nodes 必须是数组".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    if nodes.is_empty() {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODES_EMPTY".to_string(),
            message: "nodes 不能为空".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    let mut start_count = 0;
    let mut node_ids = std::collections::HashSet::new();
    let mut duplicate_node_ids = std::collections::HashSet::new();
    let mut incoming_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut outgoing_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut approval_node_ids = std::collections::HashSet::new();
    let mut loop_node_ids = std::collections::HashSet::new();
    for node in nodes {
        let node_id = node
            .get("id")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let node_type = node.get("type").and_then(|v| v.as_str()).map(str::trim);
        let data_type = node
            .get("data")
            .and_then(|v| v.as_object())
            .and_then(|data| {
                data.get("type")
                    .and_then(|v| v.as_str())
                    .or_else(|| data.get("kind").and_then(|v| v.as_str()))
            })
            .map(str::trim);
        if matches!(node_type, Some("start")) || matches!(data_type, Some("start")) {
            start_count += 1;
        }
        if matches!(node_type, Some("approval")) || matches!(data_type, Some("approval")) {
            if let Some(id) = node_id.clone() {
                approval_node_ids.insert(id);
            }
        }
        if matches!(node_type, Some("loop")) || matches!(data_type, Some("loop")) {
            if let Some(id) = node_id.clone() {
                loop_node_ids.insert(id);
            }
        }
        if node_type.is_none() {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_NODE_TYPE_MISSING".to_string(),
                message: "节点缺少 type".to_string(),
                node_id: node_id.clone(),
                edge_id: None,
            });
        }
        if let Some(id) = node_id {
            if !node_ids.insert(id.clone()) {
                duplicate_node_ids.insert(id.clone());
            }
            incoming_counts.entry(id.clone()).or_insert(0);
            outgoing_counts.entry(id).or_insert(0);
        } else {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_NODE_ID_MISSING".to_string(),
                message: "节点缺少 id".to_string(),
                node_id: None,
                edge_id: None,
            });
        }
    }
    for duplicate_id in duplicate_node_ids {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODE_ID_DUPLICATED".to_string(),
            message: "存在重复的节点 id".to_string(),
            node_id: Some(duplicate_id),
            edge_id: None,
        });
    }
    let Some(edges) = graph_obj.get("edges").and_then(|v| v.as_array()) else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGES_INVALID".to_string(),
            message: "edges 必须是数组".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    let mut edge_ids = std::collections::HashSet::new();
    let mut duplicate_edge_ids = std::collections::HashSet::new();
    if edges.is_empty() {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGES_EMPTY".to_string(),
            message: "edges 不能为空".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    {
        for edge in edges {
            let edge_id = edge
                .get("id")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            if let Some(id) = edge_id.clone() {
                if !edge_ids.insert(id.clone()) {
                    duplicate_edge_ids.insert(id);
                }
            } else {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_ID_MISSING".to_string(),
                    message: "边缺少 id".to_string(),
                    node_id: None,
                    edge_id: None,
                });
            }
            let source = edge
                .get("source")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            let target = edge
                .get("target")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            if source.is_none() || target.is_none() {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_ENDPOINT_MISSING".to_string(),
                    message: "边缺少 source 或 target".to_string(),
                    node_id: None,
                    edge_id: edge_id.clone(),
                });
                continue;
            }
            let source_id = source.unwrap_or_default();
            let target_id = target.unwrap_or_default();
            if !node_ids.contains(&source_id) {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_SOURCE_NOT_FOUND".to_string(),
                    message: "边的 source 节点不存在".to_string(),
                    node_id: Some(source_id.clone()),
                    edge_id: edge_id.clone(),
                });
            } else if let Some(count) = outgoing_counts.get_mut(&source_id) {
                *count += 1;
            }
            if !node_ids.contains(&target_id) {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_TARGET_NOT_FOUND".to_string(),
                    message: "边的 target 节点不存在".to_string(),
                    node_id: Some(target_id.clone()),
                    edge_id: edge_id.clone(),
                });
            } else if let Some(count) = incoming_counts.get_mut(&target_id) {
                *count += 1;
            }
        }
    }
    for duplicate_edge_id in duplicate_edge_ids {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGE_ID_DUPLICATED".to_string(),
            message: "存在重复的边 id".to_string(),
            node_id: None,
            edge_id: Some(duplicate_edge_id),
        });
    }
    for approval_id in approval_node_ids {
        let incoming = incoming_counts.get(&approval_id).copied().unwrap_or(0);
        let outgoing = outgoing_counts.get(&approval_id).copied().unwrap_or(0);
        if incoming == 0 {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_APPROVAL_INCOMING_MISSING".to_string(),
                message: "审批节点至少需要一条入边".to_string(),
                node_id: Some(approval_id.clone()),
                edge_id: None,
            });
        }
        if outgoing == 0 {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_APPROVAL_OUTGOING_MISSING".to_string(),
                message: "审批节点至少需要一条出边".to_string(),
                node_id: Some(approval_id),
                edge_id: None,
            });
        }
    }
    for loop_id in loop_node_ids {
        let has_body = edges.iter().any(|edge| {
            edge.get("source")
                .and_then(|v| v.as_str())
                .map(|v| v.trim())
                == Some(loop_id.as_str())
                && edge
                    .get("sourceHandle")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    == Some("loop-body")
        });
        let has_next = edges.iter().any(|edge| {
            edge.get("source")
                .and_then(|v| v.as_str())
                .map(|v| v.trim())
                == Some(loop_id.as_str())
                && edge
                    .get("sourceHandle")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    == Some("loop-next")
        });
        if !has_body {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_LOOP_BODY_MISSING".to_string(),
                message: "循环节点必须包含 loop-body 出边".to_string(),
                node_id: Some(loop_id.clone()),
                edge_id: None,
            });
        }
        if !has_next {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_LOOP_NEXT_MISSING".to_string(),
                message: "循环节点必须包含 loop-next 出边".to_string(),
                node_id: Some(loop_id),
                edge_id: None,
            });
        }
    }
    if start_count == 0 {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_START_MISSING".to_string(),
            message: "必须包含一个 start 节点".to_string(),
            node_id: None,
            edge_id: None,
        });
    } else if start_count > 1 {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_START_DUPLICATED".to_string(),
            message: "start 节点只能有一个".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    Ok(WorkflowGraphValidationResult {
        ok: errors.is_empty(),
        errors,
    })
}
