import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../../http.js";

vi.mock("../../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../../api.js";
import { registerRunResultsList } from "./list.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawIssue {
  id: number;
  externalKey: string | null;
  title: string | null;
  externalStatus: string | null;
  integration: { provider: string } | null;
}

interface RawRunResult {
  id: number;
  statusId: number;
  status: { id: number; name: string };
  executedBy: { id: string; name: string | null; email: string };
  executedAt: string;
  attempt: number;
  testRunCase: {
    id: number;
    repositoryCaseId: number;
    repositoryCase: { id: number; name: string; source: string } | null;
    testRun: { id: number; name: string } | null;
  };
}

function makeRawResult(id = 1, overrides: Partial<RawRunResult> = {}): RawRunResult {
  return {
    id,
    statusId: 1,
    status: { id: 1, name: "Passed" },
    executedBy: { id: "u1", name: "Alice", email: "a@b" },
    executedAt: "2026-02-01T00:00:00.000Z",
    attempt: 1,
    testRunCase: {
      id: 100 + id,
      repositoryCaseId: 200 + id,
      repositoryCase: { id: 200 + id, name: `Case ${id}`, source: "MANUAL" },
      testRun: { id: 50, name: "Sprint 21" },
    },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunResultsList(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as Record<string, unknown> | undefined;
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

describe("registerRunResultsList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path + mapped row shape ────────────────────────────────────────

  it("happy path: returns mapped row shape with denormalized status / executedBy / testRunCase", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawResult(10),
      makeRawResult(20),
      makeRawResult(30),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);

    const first = items[0];
    expect(first.id).toBe(10);
    expect(first.attempt).toBe(1);
    expect(first.executedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(first.status).toEqual({ id: 1, name: "Passed" });
    expect(first.executedBy).toEqual({ id: "u1", name: "Alice", email: "a@b" });
    const trc = first.testRunCase as Record<string, unknown>;
    expect(trc.id).toBe(110);
    expect(trc.repositoryCaseId).toBe(210);
    expect(trc.repositoryCase).toEqual({
      id: 210,
      name: "Case 10",
      source: "MANUAL",
    });
    expect(trc.testRun).toEqual({ id: 50, name: "Sprint 21" });

    // mapper enforces no extra keys leaked from raw rows
    expect(Object.keys(first).sort()).toEqual(
      [
        "attempt",
        "executedAt",
        "executedBy",
        "id",
        "repositoryCase",
        "source",
        "status",
        "testRun",
        "testRunCase",
      ].sort(),
    );
    expect(first.source).toBe("TestRun");
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  it("filter: runId only", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { runId: 42 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.testRunId).toBe(42);
    expect(where.isDeleted).toBe(false);
  });

  it("filter: caseIds [EXEC-06 back-half]: where.testRunCase.repositoryCaseId.in", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { caseIds: [1, 2, 3] },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    // CRITICAL: nested relation filter shape — repositoryCaseId (NOT testCaseId or caseId).
    expect(where.testRunCase).toEqual({ repositoryCaseId: { in: [1, 2, 3] } });
    expect(where.isDeleted).toBe(false);
  });

  it("filter: caseIds + runId combined", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { caseIds: [5, 6], runId: 99 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.testRunId).toBe(99);
    expect(where.testRunCase).toEqual({ repositoryCaseId: { in: [5, 6] } });
  });

  it("filter: executedById string", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { executedById: "u-99" },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.executedById).toBe("u-99");
  });

  it("filter: statusId number", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { statusId: 5 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.statusId).toBe(5);
  });

  it("filter: from + to date range on executedAt (NOT createdAt)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    const executedAt = where.executedAt as { gte: Date; lte: Date };
    expect(executedAt.gte).toBeInstanceOf(Date);
    expect(executedAt.lte).toBeInstanceOf(Date);
    expect(executedAt.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(executedAt.lte.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    // Defense: a hypothetical regression to createdAt would set this key — assert absent.
    expect(where).not.toHaveProperty("createdAt");
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  it("pagination: cursor + limit forwarded — take=limit+1, cursor={id}, skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.take).toBe(11);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
  });

  it("pagination: hasNextPage TRUE when rows.length > limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawResult(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    const data = structured(result);
    const items = data.items as unknown[];
    expect(items.length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    // Compound per-source cursor: last CONSUMED TestRunResults id.
    expect(data.nextCursor).toBe("tr:25");
  });

  it("pagination: hasNextPage FALSE when rows.length <= limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRawResult(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    const data = structured(result);
    expect(data.hasNextPage).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  // ── orderBy / determinism ────────────────────────────────────────────────

  it("deterministic orderBy: [{executedAt:'desc'},{id:'desc'}] (D7-02 + BL-04)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([
      { executedAt: "desc" },
      { id: "desc" },
    ]);
  });

  // ── DoS / safety ─────────────────────────────────────────────────────────

  it("DoS: limit > 100 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { limit: 999 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("DoS: caseIds.length > 500 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {
        caseIds: Array.from({ length: 501 }, (_, i) => i + 1),
      },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("DoS: caseIds.length === 0 rejected by zod (min(1))", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { caseIds: [] },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("always filters isDeleted: false (defense-in-depth — no input branch can drop it)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {
        runId: 1,
        caseIds: [1],
        executedById: "u",
        statusId: 1,
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  // ── Error path ───────────────────────────────────────────────────────────

  it("error path: zenstack throws TestPlanItHttpError -> mapHttpErrorToToolResult", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied by policy", {
        statusCode: 422,
        code: "POLICY_DENIAL",
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/422|Request failed/);
  });

  it("token-redaction guard: tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: name + description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRunResultsList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_test_run_results_list",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List test run results/);
  });
});

// ── JUnit union (automated-run results) ──────────────────────────────────────

interface RawJunitRow {
  id: number;
  type: string;
  message: string | null;
  time: number | null;
  executedAt: string | null;
  status: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  repositoryCase: { id: number; name: string; source: string } | null;
  testSuite: {
    id: number;
    name: string;
    testRunId: number;
    testRun: { id: number; name: string } | null;
  } | null;
}

function makeRawJunit(id = 1, overrides: Partial<RawJunitRow> = {}): RawJunitRow {
  return {
    id,
    type: "PASSED",
    message: null,
    time: 0.5,
    executedAt: "2026-02-01T00:00:00.000Z",
    status: { id: 1, name: "Passed" },
    createdBy: { id: "u9", name: "CI Bot", email: "ci@b" },
    repositoryCase: { id: 300 + id, name: `Spec ${id}`, source: "JUNIT" },
    testSuite: {
      id: 40,
      name: "auth.spec.ts",
      testRunId: 60,
      testRun: { id: 60, name: "Nightly" },
    },
    ...overrides,
  };
}

function getCallModel(index: number) {
  return mockZenstack.mock.calls[index]?.[0] as string | undefined;
}

describe("registerRunResultsList — JUnit union", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("queries BOTH testRunResults and jUnitTestResult by default", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    expect(mockZenstack).toHaveBeenCalledTimes(2);
    expect(getCallModel(0)).toBe("testRunResults");
    expect(getCallModel(1)).toBe("jUnitTestResult");
  });

  it("junit where projection: runId -> testSuite.testRunId, caseIds -> repositoryCaseId.in, executedById -> createdById; NO isDeleted (model has none)", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {
        runId: 60,
        caseIds: [1, 2],
        executedById: "u9",
        statusId: 3,
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      },
    });
    const juWhere = getCallBody(1)?.where as Record<string, unknown>;
    expect(juWhere.testSuite).toEqual({ testRunId: 60 });
    expect(juWhere.repositoryCaseId).toEqual({ in: [1, 2] });
    expect(juWhere.createdById).toBe("u9");
    expect(juWhere.statusId).toBe(3);
    expect(juWhere).toHaveProperty("executedAt");
    // JUnitTestResult has no soft-delete column — the filter must NOT exist.
    expect(juWhere).not.toHaveProperty("isDeleted");
  });

  it("automated run scenario: no TestRunResults rows -> items come back with source JUnit", async () => {
    mockZenstack.mockResolvedValueOnce([]); // testRunResults
    mockZenstack.mockResolvedValueOnce([makeRawJunit(7), makeRawJunit(6)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { runId: 60 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
    expect(items[0].source).toBe("JUnit");
    expect(items[0].id).toBe(7);
    expect(items[0].junitType).toBe("PASSED");
    expect(items[0].repositoryCase).toEqual({
      id: 307,
      name: "Spec 7",
      source: "JUNIT",
    });
    expect(items[0].testRun).toEqual({ id: 60, name: "Nightly" });
    expect(items[0].suite).toEqual({ id: 40, name: "auth.spec.ts" });
    expect(items[0].testRunCase).toBeNull();
  });

  it("merged ordering: interleaves the two sources by executedAt desc", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawResult(1, { executedAt: "2026-02-04T00:00:00.000Z" }),
      makeRawResult(2, { executedAt: "2026-02-02T00:00:00.000Z" }),
    ]);
    mockZenstack.mockResolvedValueOnce([
      makeRawJunit(9, { executedAt: "2026-02-03T00:00:00.000Z" }),
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: {},
    });
    const items = structured(result).items as Array<Record<string, unknown>>;
    expect(items.map((i) => `${i.source}:${i.id}`)).toEqual([
      "TestRun:1",
      "JUnit:9",
      "TestRun:2",
    ]);
  });

  it("source filter 'TestRun' -> junit table not queried", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { source: "TestRun" },
    });
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(getCallModel(0)).toBe("testRunResults");
  });

  it("source filter 'JUnit' -> testRunResults not queried", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { source: "JUnit" },
    });
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(getCallModel(0)).toBe("jUnitTestResult");
  });

  it("compound cursor fans out to per-source keyset cursors", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { cursor: "tr:100|ju:50", limit: 10 },
    });
    const trBody = getCallBody(0);
    const juBody = getCallBody(1);
    expect(trBody?.cursor).toEqual({ id: 100 });
    expect(trBody?.skip).toBe(1);
    expect(trBody?.take).toBe(11);
    expect(juBody?.cursor).toEqual({ id: 50 });
    expect(juBody?.skip).toBe(1);
    expect(juBody?.take).toBe(11);
  });

  it("legacy numeric cursor applies to testRunResults only (junit starts from top)", async () => {
    mockZenstack.mockResolvedValue([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { cursor: 100 },
    });
    expect(getCallBody(0)?.cursor).toEqual({ id: 100 });
    expect(getCallBody(1)?.cursor).toBeUndefined();
    expect(getCallBody(1)?.skip).toBeUndefined();
  });

  it("malformed cursor -> input error, no queries issued", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { cursor: "bogus" },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("junit-only pagination emits a ju: cursor", async () => {
    mockZenstack.mockResolvedValueOnce([]); // testRunResults exhausted
    mockZenstack.mockResolvedValueOnce([
      makeRawJunit(9),
      makeRawJunit(8),
      makeRawJunit(7),
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_list",
      arguments: { limit: 2 },
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(2);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe("ju:8");
  });
});
