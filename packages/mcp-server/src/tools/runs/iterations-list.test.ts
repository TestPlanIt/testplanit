import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({ zenstack: vi.fn() }));

import { zenstack } from "../../api.js";
import { registerRunCaseIterationsList } from "./iterations-list.js";

const mockZenstack = vi.mocked(zenstack);
const env = { apiUrl: "https://tpi.example.com", apiToken: "tpi_x" };

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunCaseIterationsList(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({
    name: "testplanit_test_run_case_iterations_list",
    arguments: args,
  });
}

describe("testplanit_test_run_case_iterations_list", () => {
  beforeEach(() => mockZenstack.mockReset());

  it("lists iterations in row order with sensitive values redacted", async () => {
    mockZenstack.mockResolvedValueOnce({
      id: 50,
      totalIterations: 2,
      dataSetSnapshot: {
        parametersJson: [
          { name: "user", sensitive: false },
          { name: "password", sensitive: true },
        ],
      },
    });
    mockZenstack.mockResolvedValueOnce([
      {
        id: 7,
        rowIndex: 0,
        label: "alice",
        valuesJson: { user: "alice", password: "hunter2" },
        isCompleted: true,
        status: { id: 1, name: "Passed" },
      },
      {
        id: 8,
        rowIndex: 1,
        label: "bob",
        valuesJson: { user: "bob", password: "secret" },
        isCompleted: false,
        status: null,
      },
    ]);

    const result = await call({ testRunCaseId: 50 });
    const out = result.structuredContent as any;

    expect(out.totalIterations).toBe(2);
    expect(out.items.map((i: any) => i.id)).toEqual([7, 8]);
    expect(out.items[0].values).toEqual({ user: "alice", password: "••••••" });
    expect(JSON.stringify(out)).not.toContain("hunter2");
    const where = (mockZenstack.mock.calls[1]![2] as any).where;
    expect(where).toEqual({ testRunCaseId: 50, isDeleted: false });
  });

  it("reports a missing run case", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const result = await call({ testRunCaseId: 404 });
    expect(result.isError).toBe(true);
  });
});
