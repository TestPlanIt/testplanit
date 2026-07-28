import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRunsGet, runDetailInclude } from "./get.js";
import { runDetailTestCaseInclude } from "./shared.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

function makeTestCase(id = 1, overrides: Record<string, unknown> = {}) {
  return {
    id,
    order: id,
    isCompleted: false,
    repositoryCase: { id: 100 + id, name: `Case ${id}`, source: "MANUAL" },
    assignedTo: { id: "u9", name: "Bob", email: "b@b" },
    status: { id: 1, name: "Passed" },
    results: [
      {
        id: 9000 + id,
        statusId: 1,
        status: { id: 1, name: "Passed" },
        executedBy: { id: "u9", name: "Bob", email: "b@b" },
        executedAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function makeRawRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    name: "Sprint 21",
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    testRunType: "REGULAR",
    project: { id: 7, name: "P1" },
    state: { id: 3, name: "In Progress" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    configuration: { id: 4, name: "Chrome" },
    milestone: { id: 8, name: "v1.0" },
    tags: [{ id: 1, name: "smoke" }],
    issues: [],
    testCases: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsGet(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as Record<string, unknown> | undefined;
}

describe("registerRunsGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: full detail shape with statusCounts + 3 testCases inline", async () => {
    const cases = [makeTestCase(1), makeTestCase(2), makeTestCase(3)];
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: cases }));
    mockZenstack.mockResolvedValueOnce([
      { statusId: 1, _count: { id: 2 } },
      { statusId: 2, _count: { id: 1 } },
    ]);
    mockZenstack.mockResolvedValueOnce([
      { id: 1, name: "Passed" },
      { id: 2, name: "Failed" },
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.id).toBe(50);
    expect(data.name).toBe("Sprint 21");
    const sc = data.statusCounts as Array<{ id: number; name: string; count: number }>;
    expect(sc).toEqual(
      expect.arrayContaining([
        { id: 1, name: "Passed", count: 2 },
        { id: 2, name: "Failed", count: 1 },
      ]),
    );
    expect(data.untested).toBe(0);
    expect(data.total).toBe(3);
    expect((data.testCases as unknown[]).length).toBe(3);
    expect(data.testCasesNextCursor).toBeNull();
  });

  it("R3: counts SUM to total — including untested groups", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [makeTestCase(1)] }));
    mockZenstack.mockResolvedValueOnce([
      { statusId: 1, _count: { id: 5 } },
      { statusId: null, _count: { id: 3 } },
    ]);
    mockZenstack.mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    const sc = data.statusCounts as Array<{ count: number }>;
    expect(sc.reduce((s, c) => s + c.count, 0) + (data.untested as number)).toBe(
      data.total,
    );
    expect(data.total).toBe(8);
    expect(data.untested).toBe(3);
  });

  it("run not found: zenstack returns null -> isError with run id in message", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Test run");
    expect(text).toContain("999");
  });

  it("first 50 cases inline + nextCursor when total > 50", async () => {
    const cases = Array.from({ length: 50 }, (_, i) => makeTestCase(i + 1));
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: cases }));
    mockZenstack.mockResolvedValueOnce([
      { statusId: 1, _count: { id: 120 } },
    ]);
    mockZenstack.mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    expect((data.testCases as unknown[]).length).toBe(50);
    // Cursor is the id of the 50th case (the last inline case).
    expect(data.testCasesNextCursor).toBe(50);
    expect(data.total).toBe(120);
  });

  it("total <= 50: nextCursor is null", async () => {
    const cases = Array.from({ length: 10 }, (_, i) => makeTestCase(i + 1));
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: cases }));
    mockZenstack.mockResolvedValueOnce([{ statusId: 1, _count: { id: 10 } }]);
    mockZenstack.mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    expect((data.testCases as unknown[]).length).toBe(10);
    expect(data.testCasesNextCursor).toBeNull();
  });

  it("testCases ordering inline: [{order:'asc'},{id:'asc'}]", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [] }));
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const tc = include?.testCases as Record<string, unknown>;
    expect(tc.orderBy).toEqual([{ order: "asc" }, { id: "asc" }]);
    expect(tc.take).toBe(50);
  });

  it("testCases inline include uses runDetailTestCaseInclude(runId)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [] }));
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const tc = include?.testCases as Record<string, unknown>;
    expect(tc.include).toEqual(runDetailTestCaseInclude(50));
    // Defense-in-depth: verify the include shape carries the agent-facing keys.
    const tcInclude = tc.include as Record<string, unknown>;
    expect(tcInclude).toHaveProperty("repositoryCase");
    expect(tcInclude).toHaveProperty("assignedTo");
    expect(tcInclude).toHaveProperty("status");
    expect(tcInclude).toHaveProperty("results");
    // JUnit half of latestResult is scoped to the requested run.
    const rc = tcInclude.repositoryCase as {
      select: { junitResults: { where: unknown } };
    };
    expect(rc.select.junitResults.where).toEqual({
      testSuite: { testRunId: 50 },
    });
  });

  it("runDetailInclude exposes the full inline-cases shape (defense-in-depth)", () => {
    const detailInclude = runDetailInclude(50);
    expect(detailInclude).toHaveProperty("project");
    expect(detailInclude).toHaveProperty("state");
    expect(detailInclude).toHaveProperty("createdBy");
    expect(detailInclude).toHaveProperty("testCases");
    const tc = (detailInclude as { testCases: Record<string, unknown> }).testCases;
    expect(tc.take).toBe(50);
    expect(tc.orderBy).toEqual([{ order: "asc" }, { id: "asc" }]);
  });

  it("mapRunDetailTestCase output: latestResult derived from results[0], not step results", async () => {
    const cases = [makeTestCase(1)];
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: cases }));
    mockZenstack.mockResolvedValueOnce([{ statusId: 1, _count: { id: 1 } }]);
    mockZenstack.mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    const tc = (data.testCases as Array<Record<string, unknown>>)[0];
    const latest = tc.latestResult as Record<string, unknown>;
    expect(latest.id).toBe(9001);
    expect((latest.status as { id: number; name: string }).name).toBe("Passed");
    expect((latest.executedBy as { id: string }).id).toBe("u9");
  });

  it("mapRunRow extras present: testRunType, configuration, milestone, issues array", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [] }));
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    expect(data.testRunType).toBe("REGULAR");
    expect(data.configuration).toEqual({ id: 4, name: "Chrome" });
    expect(data.milestone).toEqual({ id: 8, name: "v1.0" });
    expect(Array.isArray(data.issues)).toBe(true);
  });

  it("R1: NO isDeleted filter on testCases inline include", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [] }));
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const tc = include?.testCases as Record<string, unknown>;
    expect(tc).not.toHaveProperty("where");
  });

  it("error path: extractStatusNames groupBy throws -> mapHttpErrorToToolResult", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawRun({ testCases: [] }));
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("rollup boom", { statusCode: 500 }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/HTTP 500|Request failed/);
  });

  it("token-redaction guard: tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_get",
      arguments: { runId: 50 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).not.toContain("tpi_test_secret");
  });

  it("tool registration: name + description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRunsGet(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_test_runs_get");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^Fetch a single test run/);
  });
});
