import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRunsCasesList } from "./cases.js";
import { runDetailTestCaseInclude } from "./shared.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

function makeRawCase(id = 1, overrides: Record<string, unknown> = {}) {
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

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsCasesList(server, deps);
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

function getLastCallBody() {
  const calls = mockZenstack.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][2] as Record<string, unknown>;
}

describe("registerRunsCasesList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: lists testRunCases with denormalized fields + latestResult", async () => {
    const rows = [makeRawCase(1), makeRawCase(2), makeRawCase(3)];
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);
    const first = items[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("order");
    expect(first).toHaveProperty("isCompleted");
    expect(first).toHaveProperty("repositoryCase");
    expect(first).toHaveProperty("assignedTo");
    expect(first).toHaveProperty("status");
    expect(first).toHaveProperty("latestResult");
    const latest = first.latestResult as Record<string, unknown>;
    expect(latest.id).toBe(9001);
  });

  it("filter: isCompleted=true", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50, isCompleted: true },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(true);
    expect(where.testRunId).toBe(50);
    // Soft-removed run cases are excluded (TestRunCases gained isDeleted with
    // the run-case removal feature).
    expect(where.isDeleted).toBe(false);
  });

  it("filter: statusId", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50, statusId: 5 },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.statusId).toBe(5);
  });

  it("filter: assignedToId is a string (User PK is string in TestPlanIt)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50, assignedToId: "user-99" },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.assignedToId).toBe("user-99");
  });

  it("R1 (revised): soft-removed run cases are filtered with isDeleted: false", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  it("pagination: hasNextPage TRUE when rows.length > limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawCase(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);
  });

  it("pagination: cursor + limit forwarded — take=limit+1, cursor={id}, skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50, cursor: 10, limit: 5 },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(6);
    expect(body?.cursor).toEqual({ id: 10 });
    expect(body?.skip).toBe(1);
  });

  it("deterministic orderBy: [{order:'asc'},{id:'asc'}]", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    const body = getLastCallBody();
    expect(body?.orderBy).toEqual([{ order: "asc" }, { id: "asc" }]);
  });

  it("uses runDetailTestCaseInclude(runId) from shared — junit half scoped to THIS run", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    const body = getLastCallBody();
    expect(body?.include).toEqual(runDetailTestCaseInclude(50));
    // The JUnit half of latestResult must be scoped to the requested run —
    // an unscoped include would surface results from OTHER runs of the case.
    const include = body?.include as {
      repositoryCase: { select: { junitResults: { where: unknown } } };
    };
    expect(include.repositoryCase.select.junitResults.where).toEqual({
      testSuite: { testRunId: 50 },
    });
  });

  it("DoS: limit > 100 rejected by zod", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50, limit: 999 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("error path: zenstack throws -> mapHttpErrorToToolResult", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied", { statusCode: 422, code: "POLICY_DENIAL" }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/422|Request failed/);
  });

  it("token-redaction guard: tpi_ does not leak", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_cases_list",
      arguments: { runId: 50 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).not.toContain("tpi_secret");
  });

  it("tool registration: name + description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRunsCasesList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_test_runs_cases_list",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List the test cases assigned to a specific run/);
  });
});
