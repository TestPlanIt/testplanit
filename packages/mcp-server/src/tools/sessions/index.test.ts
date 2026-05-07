import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSessions } from "./index.js";

describe("registerSessions", () => {
  it("registers both session read tools (list, get)", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessions(server, {
      env: { apiUrl: "https://x", apiToken: "tpi_x" },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("testplanit_sessions_list");
    expect(names).toContain("testplanit_sessions_get");
  });
});
