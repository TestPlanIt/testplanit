import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuns } from "./index.js";

describe("registerRuns", () => {
  it("registers all three test-run tools (list, get, cases_list)", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRuns(server, {
      env: { apiUrl: "https://x", apiToken: "tpi_x" },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("testplanit_test_runs_list");
    expect(names).toContain("testplanit_test_runs_get");
    expect(names).toContain("testplanit_test_runs_cases_list");
  });
});
