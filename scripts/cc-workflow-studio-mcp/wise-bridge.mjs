/**
 * Wise 内嵌 CC Workflow Studio：MCP 工具 → Rust Webview 桥（/invoke）。
 */

const base = (process.env.WISE_CC_WF_BRIDGE_BASE || "").replace(/\/$/, "");
const token = (process.env.WISE_CC_WF_BRIDGE_TOKEN || "").trim();
const repo = (process.env.WISE_CC_WF_REPO || "").trim();

export async function bridgeInvoke(op, payload = {}) {
  if (!base || !token) {
    throw new Error("缺少 WISE_CC_WF_BRIDGE_BASE 或 WISE_CC_WF_BRIDGE_TOKEN");
  }
  const r = await fetch(`${base}/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ op, payload }),
  }).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `无法连接 CC Workflow Studio Webview 桥（${base}/invoke）：${msg}。请保持 Workflow Studio 已打开或刚通过 AI 编辑启动过 MCP。`,
    );
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`桥返回非 JSON: ${text.slice(0, 200)}`);
  }
  if (!j.ok) {
    throw new Error(j.error || "bridge error");
  }
  return j.data;
}

export function getRepoPath() {
  return repo;
}

/** 对齐上游 McpServerManager 的 Webview 桥接语义 */
export class WiseMcpBridgeManager {
  constructor() {
    this.reviewBeforeApply = process.env.WISE_CC_WF_REVIEW_BEFORE_APPLY !== "false";
    this.extensionPath = process.env.CC_WF_STUDIO_ROOT || "";
    this.lastKnownWorkflow = null;
  }

  getExtensionPath() {
    return this.extensionPath || null;
  }

  getReviewBeforeApply() {
    return this.reviewBeforeApply;
  }

  setReviewBeforeApply(v) {
    this.reviewBeforeApply = Boolean(v);
  }

  async requestCurrentWorkflow() {
    const data = await bridgeInvoke("get_current_workflow", {});
    const workflow = data?.workflow ?? null;
    const revision = typeof data?.revision === "number" ? data.revision : -1;
    const isStale = Boolean(data?.isStale);
    if (workflow) {
      this.lastKnownWorkflow = workflow;
    }
    return { workflow, isStale, revision };
  }

  async applyWorkflowToCanvas(workflow, description, plannedFiles, expectedRevision) {
    const payload = {
      workflow,
      requireConfirmation: this.reviewBeforeApply,
      description: description || "",
      plannedFiles: plannedFiles?.length ? plannedFiles : undefined,
      expectedRevision,
    };
    const data = await bridgeInvoke("apply_workflow_from_mcp", payload);
    if (data?.success === false) {
      throw new Error(data.error || "User rejected the changes");
    }
    return data?.success !== false;
  }

  highlightGroupNode(groupNodeId) {
    void bridgeInvoke("highlight_group_node", { groupNodeId });
  }
}
