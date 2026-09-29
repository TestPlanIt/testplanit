import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({ zenstack: vi.fn(), postHostJson: vi.fn() }));

import { postHostJson, zenstack } from "../../api.js";
import { registerRunsCasesAdd } from "./cases-add.js";

const mockZenstack = vi.mocked(zenstack);
const env = { apiUrl: "https://tpi.example.com", apiToken: "tpi_x" };

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsCasesAdd(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name: "testplanit_runs_cases_add", arguments: args });
}

const byOp = (model: string, op: string) =>
  mockZenstack.mock.calls.filter((c) => c[0] === model && c[1] === op);

describe("testplanit_runs_cases_add", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
    vi.mocked(postHostJson).mockReset();
    mockZenstack.mockImplementation(async (model: string, op: string) => {
      if (op === "aggregate") return { _max: { order: 4 } };
      if (model === "testRunCases" && op === "findMany") return [{ id: 31 }];
      if (op === "updateMany") return { count: 1 };
      if (op === "count") return 6;
      return { count: 2 };
    });
    vi.mocked(postHostJson).mockResolvedValue({ async: false, iterationCount: 3 });
  });

  it("appends new cases after the run's last one", async () => {
    await call({ runId: 9, caseIds: [1, 2] });
    const [createMany] = byOp("testRunCases", "createMany");
    expect((createMany![2] as any).data).toEqual([
      { testRunId: 9, repositoryCaseId: 1, order: 5 },
      { testRunId: 9, repositoryCaseId: 2, order: 6 },
    ]);
  });

  it("restores a removed case untested, with its iterations untested too", async () => {
    const result = await call({ runId: 9, caseIds: [1] });

    const [restoreCases, restoreIterations] = byOp("testRunCases", "updateMany")
      .concat(byOp("testRunCaseIteration", "updateMany"));
    expect((restoreCases![2] as any).where).toEqual({ id: { in: [31] } });
    expect((restoreCases![2] as any).data).toMatchObject({
      isDeleted: false,
      statusId: null,
      isCompleted: false,
      passedIterations: 0,
    });
    expect((restoreIterations![2] as any)).toMatchObject({
      where: { testRunCaseId: { in: [31] }, isDeleted: true },
      data: { isDeleted: false, statusId: null, isCompleted: false },
    });
    expect((result.structuredContent as any).restored).toBe(1);
  });

  it("generates iterations for data-driven cases and reports them", async () => {
    const result = await call({ runId: 9, caseIds: [1] });
    expect(vi.mocked(postHostJson).mock.calls[0]![0]).toBe(
      "/api/test-runs/9/generate-iterations",
    );
    expect((result.structuredContent as any).iterations).toEqual({
      generated: true,
      iterationCount: 3,
      async: false,
    });
  });
});
