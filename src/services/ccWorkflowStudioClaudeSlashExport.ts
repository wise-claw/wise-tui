import type { Workflow } from "@cc-workflow-studio-core/workflow-definition";
import {
  generateExecutionInstructions,
  generateMermaidFlowchart,
} from "@cc-workflow-studio-core/workflow-prompt-generator";

function yamlEscapeQuotedLine(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();
}

function buildFrontmatter(workflow: Workflow): string {
  const desc =
    workflow.description?.trim() ||
    `Execute CC Workflow Studio workflow "${workflow.name}" (Claude Code + cc-workflow-studio MCP).`;
  const lines: string[] = ["---", `name: ${workflow.name}`];
  lines.push(`description: "${yamlEscapeQuotedLine(desc)}"`);
  const opts = workflow.slashCommandOptions;
  if (opts?.allowedTools?.trim()) {
    lines.push(`allowed-tools: "${yamlEscapeQuotedLine(opts.allowedTools)}"`);
  }
  if (opts?.model && opts.model !== "default") {
    lines.push(`model: ${opts.model}`);
  }
  if (opts?.context && opts.context !== "default") {
    lines.push(`context: ${opts.context}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * 生成与上游 VS Code 扩展等价的 Claude Code Slash Command（`.claude/commands/<name>.md`）正文。
 * 供 Wise 宿主在「导出 / 运行」时写入仓库，并在 Claude Code 会话中通过 `/<name>` 执行。
 */
export function buildClaudeSlashCommandMarkdown(workflow: Workflow, highlightEnabled: boolean): string {
  const mermaid = generateMermaidFlowchart({
    nodes: workflow.nodes,
    connections: workflow.connections,
    labelMode: "detailed",
    direction: "TD",
  });
  const exec = generateExecutionInstructions(workflow, {
    provider: "claude-code",
    subAgentFlows: workflow.subAgentFlows,
    parentWorkflowName: workflow.name,
    highlightEnabled,
  });
  const fm = buildFrontmatter(workflow);
  return `${fm}

## Workflow diagram

\`\`\`mermaid
${mermaid}
\`\`\`

${exec}

## Source file

Canonical workflow JSON: \`.wise/workflows/${workflow.name}.json\`

When the canvas changes in Wise CC Workflow Studio, use the \`cc-workflow-studio\` MCP server (\`get_current_workflow\` / \`apply_workflow\`) to stay aligned before executing steps that depend on the latest node data.
`;
}
