import { describe, expect, test } from "bun:test";
import {
  knowledgeConfigFromNodeData,
  renderKnowledgeRetrievalBlock,
  summarizeKnowledgeConfig,
} from "./workflowKnowledgeRetrieval";

describe("workflowKnowledgeRetrieval", () => {
  test("migrates legacy knowledgeQuery string", () => {
    const config = knowledgeConfigFromNodeData({
      label: "KB",
      knowledgeQuery: "workflow runtime dispatch",
    });
    expect(config.query).toContain("workflow runtime");
    expect(config.topK).toBe(20);
  });

  test("renders retrieval block with variable substitution and settings", () => {
    const block = renderKnowledgeRetrievalBlock(
      {
        query: "与 {{topic}} 相关的 API",
        searchMode: "hybrid",
        nodeKinds: ["symbol", "api_operation"],
        topK: 10,
        subgraphHop: 2,
        subgraphDirection: "downstream",
        outputMode: "structured",
        requireCitation: true,
        outputVariable: "kg_context",
        supplementQueries: ["{{topic}} service"],
        pathPrefix: "src/services",
      },
      { variables: { topic: "工作流" }, taskContent: "原始任务" },
    );
    expect(block).toContain("【知识检索");
    expect(block).toContain("工作流");
    expect(block).toContain("Top K：10");
    expect(block).toContain("src/services");
    expect(block).toContain("kg_context");
    expect(block).toContain("补充 1");
  });

  test("summarizes config for canvas node card", () => {
    const summary = summarizeKnowledgeConfig({
      query: "Claude session IPC",
      searchMode: "keyword",
      nodeKinds: ["file"],
      topK: 15,
      subgraphHop: 0,
      subgraphDirection: "both",
      outputMode: "summary",
      requireCitation: false,
      supplementQueries: [],
    });
    expect(summary).toContain("关键词");
    expect(summary).toContain("Top 15");
    expect(summary).toContain("Claude");
  });
});
