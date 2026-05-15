/**
 * 对齐上游 cc-wf-studio/src/extension/services/mcp-server-tools.ts（工具名与语义一致）。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { bridgeInvoke, getRepoPath } from "./wise-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function schemaToonPath() {
  const fromEnv = process.env.CC_WF_STUDIO_SCHEMA_TOON?.trim();
  if (fromEnv) return fromEnv;
  return path.join(__dirname, "resources", "workflow-schema.toon");
}

function minimalValidateWorkflow(obj) {
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: [{ message: "workflow must be an object" }] };
  }
  const w = obj;
  if (typeof w.name !== "string" || !Array.isArray(w.nodes) || !Array.isArray(w.connections)) {
    return {
      valid: false,
      errors: [{ message: "workflow requires name, nodes[], connections[]" }],
    };
  }
  return { valid: true, errors: [] };
}

async function listAgents(includeContent) {
  return bridgeInvoke("list_available_agents", {
    repositoryPath: getRepoPath(),
    includeContent: Boolean(includeContent),
  });
}

function mergeNodeUpdates(workflow, updates) {
  const w = structuredClone(workflow);
  const byId = new Map(w.nodes.map((n) => [n.id, n]));
  for (const u of updates) {
    const node = byId.get(u.id);
    if (!node) continue;
    if (u.name !== undefined) node.name = u.name;
    if (u.position !== undefined) node.position = u.position;
    if (u.type !== undefined) node.type = u.type;
    if (u.data !== undefined) {
      const merged = { ...node.data, ...u.data };
      for (const k of Object.keys(merged)) {
        if (merged[k] === null) delete merged[k];
      }
      node.data = merged;
    }
    if ("parentId" in u) {
      if (u.parentId == null) delete node.parentId;
      else node.parentId = u.parentId;
    }
    if (u.style !== undefined) node.style = u.style;
  }
  return w;
}

export function registerMcpTools(server, manager) {
  server.tool(
    "get_current_workflow",
    "Get the currently active workflow from CC Workflow Studio canvas. Returns the workflow JSON and whether it is stale (from cache when the editor is closed).",
    {},
    async () => {
      try {
        const result = await manager.requestCurrentWorkflow();
        if (!result.workflow) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "No active workflow. Please open a workflow in CC Workflow Studio first.",
                }),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                isStale: result.isStale,
                revision: result.revision,
                workflow: result.workflow,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_workflow_schema",
    "Get the workflow schema documentation in optimized TOON format. Use this to understand the valid structure for creating or modifying workflows.",
    {},
    async () => {
      try {
        const p = schemaToonPath();
        const schemaString = await fs.readFile(p, "utf-8");
        return { content: [{ type: "text", text: schemaString }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "apply_workflow",
    "Apply a workflow to the CC Workflow Studio canvas. The workflow is validated before being applied. If the user has review mode enabled, they will see a diff preview and must accept changes before they are applied.",
    {
      workflow: z.string().describe("The workflow JSON string to apply to the canvas"),
      description: z.string().optional(),
      revision: z.number().optional(),
    },
    async ({ workflow: workflowJson, description, revision }) => {
      try {
        let parsed;
        try {
          parsed = JSON.parse(workflowJson);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: false, error: "Invalid JSON: Failed to parse workflow string" }),
              },
            ],
            isError: true,
          };
        }
        const validation = minimalValidateWorkflow(parsed);
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "Validation failed",
                  validationErrors: validation.errors,
                }),
              },
            ],
            isError: true,
          };
        }
        const applied = await manager.applyWorkflowToCanvas(parsed, description, [], revision);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: applied }) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "list_available_agents",
    "List available .claude/agents/*.md agent files that can be referenced as sub-agent nodes in workflows.",
    {
      includeContent: z.boolean().optional().default(false),
    },
    async ({ includeContent }) => {
      try {
        const data = await listAgents(includeContent);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "update_nodes",
    "Update specific nodes in the current workflow by ID. More efficient than apply_workflow for partial changes.",
    {
      nodes: z.array(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          position: z.object({ x: z.number(), y: z.number() }).optional(),
          data: z.record(z.string(), z.unknown()).optional(),
          type: z.string().optional(),
          parentId: z.string().nullable().optional(),
          style: z
            .object({ width: z.number().optional(), height: z.number().optional() })
            .optional(),
        }),
      ),
      description: z.string().optional(),
      revision: z.number().optional(),
    },
    async ({ nodes: nodeUpdates, description, revision }) => {
      try {
        const result = await manager.requestCurrentWorkflow();
        if (!result.workflow) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "No active workflow. Please open a workflow in CC Workflow Studio first.",
                }),
              },
            ],
            isError: true,
          };
        }
        const missing = nodeUpdates.map((u) => u.id).filter((id) => !result.workflow.nodes.some((n) => n.id === id));
        if (missing.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Nodes not found: ${missing.join(", ")}`,
                }),
              },
            ],
            isError: true,
          };
        }
        const updated = mergeNodeUpdates(result.workflow, nodeUpdates);
        const validation = minimalValidateWorkflow(updated);
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "Validation failed",
                  validationErrors: validation.errors,
                }),
              },
            ],
            isError: true,
          };
        }
        const applied = await manager.applyWorkflowToCanvas(
          updated,
          description,
          [],
          revision ?? result.revision,
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ success: applied }) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "highlight_group_node",
    "Highlight a group node on the CC Workflow Studio canvas.",
    {
      groupNodeId: z.string().describe("Group node id; empty string clears highlight"),
    },
    async ({ groupNodeId }) => {
      try {
        const effectiveId = groupNodeId || null;
        manager.highlightGroupNode(effectiveId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, highlightedGroupNodeId: effectiveId }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
