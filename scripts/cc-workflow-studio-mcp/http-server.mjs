#!/usr/bin/env bun
/**
 * Wise 内嵌 CC Workflow Studio — HTTP MCP Server（对齐上游 mcp-server-service.ts）
 * 监听 127.0.0.1:{WISE_CC_WF_MCP_PORT|6282}/mcp ，Streamable HTTP stateless 模式。
 */

import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WiseMcpBridgeManager } from "./wise-bridge.mjs";
import { registerMcpTools } from "./register-tools.mjs";

const MCP_PORT = Number.parseInt(process.env.WISE_CC_WF_MCP_PORT || "6282", 10);
const manager = new WiseMcpBridgeManager();

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      const ok =
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.protocol === "http:";
      if (!ok) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
    } catch {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (req.method === "POST" || req.method === "GET" || req.method === "DELETE") {
    let mcpServer;
    try {
      mcpServer = new McpServer({ name: "cc-workflow-studio", version: "1.0.0-wise" });
      registerMcpTools(mcpServer, manager);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    } finally {
      if (mcpServer) {
        await mcpServer.close().catch(() => {});
      }
    }
    return;
  }

  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
});

server.listen(MCP_PORT, "127.0.0.1", () => {
  process.stdout.write(`[cc-wf-studio-mcp] listening http://127.0.0.1:${MCP_PORT}/mcp\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(
      `[cc-wf-studio-mcp] port ${MCP_PORT} in use: ${err.message}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`[cc-wf-studio-mcp] ${err.message}\n`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
