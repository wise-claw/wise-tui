import { describe, expect, test } from "bun:test";
import type { McpTransport } from "./mcp";
import { wiseMcpTransportToCursor } from "./cursorMcpConfig";

describe("wiseMcpTransportToCursor", () => {
  test("maps stdio transport", () => {
    const transport: McpTransport = {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { FOO: "bar" },
    };
    expect(wiseMcpTransportToCursor(transport)).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { FOO: "bar" },
    });
  });

  test("maps streamable_http to http", () => {
    const transport: McpTransport = {
      type: "streamable_http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    };
    expect(wiseMcpTransportToCursor(transport)).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });
});
