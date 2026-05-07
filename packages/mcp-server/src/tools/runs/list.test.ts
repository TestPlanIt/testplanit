import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRunsList } from "./list.js";

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

interface RawRun {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
  testRunType: string;
  project: { id: number; name: string };
  state: { id: number; name: string };
  createdBy: { id: string; name: string | null; email: string };
  configuration: { id: number; name: string } | null;
  milestone: { id: number; name: string } | null;
  tags: Array<{ id: number; name: string }>;
  issues: RawIssue[];
}

function makeRawRun(id = 1, overrides: Partial<RawRun> = {}): RawRun {
  return {
    id,
    name: `Run ${id}`,
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    testRunType: "REGULAR",
    project: { id: 7, name: "P1" },
    state: { id: 3, name: "In Progress" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    configuration: null,
    milestone: null,
    tags: [],
    issues: [],
    ...overrides,
  };
}

/**
 * Mock the (up to) three zenstack responses the handler issues per page:
 *   1. testRuns.findMany       -> rows
 *   2. testRunCases.groupBy    -> groups (skipped if rows empty)
 *   3. status.findMany         -> statuses (skipped if no non-null statusIds)
 *
 * Tests that exercise short-circuit paths only mock the calls actually made.
 */
function mockSequence(
  rows: unknown[],
  groups: unknown[] | null = [],
  statuses: unknown[] | null = [],
) {
  mockZenstack.mockResolvedValueOnce(rows);
  if (groups !== null) mockZenstack.mockResolvedValueOnce(groups);
  if (statuses !== null) mockZenstack.mockResolvedValueOnce(statuses);
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsList(server, deps);
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

describe("registerRunsList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path + statusCounts shape ──────────────────────────────────────

  it("happy path: returns mapped row shape with statusCounts inline", async () => {
    mockSequence(
      [makeRawRun(10), makeRawRun(20)],
      [
        { testRunId: 10, statusId: 1, _count: { id: 5 } },
        { testRunId: 10, statusId: 2, _count: { id: 2 } },
        { testRunId: 10, statusId: null, _count: { id: 1 } },
        { testRunId: 20, statusId: 1, _count: { id: 3 } },
      ],
      [
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
      ],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);

    expect(items[0].id).toBe(10);
    const sc0 = items[0].statusCounts as Array<{ id: number; name: string; count: number }>;
    expect(sc0).toEqual(
      expect.arrayContaining([
        { id: 1, name: "Passed", count: 5 },
        { id: 2, name: "Failed", count: 2 },
      ]),
    );
    expect(sc0.length).toBe(2);
    expect(items[0].untested).toBe(1);
    expect(items[0].total).toBe(8);

    expect(items[1].id).toBe(20);
    expect(items[1].total).toBe(3);
    expect(items[1].untested).toBe(0);
  });

  it("R3 invariant: counts SUM to total for every row", async () => {
    mockSequence(
      [makeRawRun(10), makeRawRun(20)],
      [
        { testRunId: 10, statusId: 1, _count: { id: 5 } },
        { testRunId: 10, statusId: 2, _count: { id: 2 } },
        { testRunId: 10, statusId: null, _count: { id: 1 } },
        { testRunId: 20, statusId: 1, _count: { id: 3 } },
      ],
      [
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
      ],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const items = structured(result).items as Array<{
      statusCounts: Array<{ count: number }>;
      untested: number;
      total: number;
    }>;
    for (const row of items) {
      const sum = row.statusCounts.reduce((s, c) => s + c.count, 0);
      expect(sum + row.untested).toBe(row.total);
    }
  });

  it("empty result set short-circuits the rollup (no groupBy / no status findMany)", async () => {
    // Only mock the first call — assert the others were never invoked.
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });

    expect(mockZenstack.mock.calls.length).toBe(1);
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(0);
    expect(data.hasNextPage).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  it("all-null statusIds short-circuits the status findMany", async () => {
    mockSequence(
      [makeRawRun(30)],
      [{ testRunId: 30, statusId: null, _count: { id: 7 } }],
      null, // status findMany must NOT be called
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });

    expect(mockZenstack.mock.calls.length).toBe(2);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect((items[0].statusCounts as unknown[])).toEqual([]);
    expect(items[0].untested).toBe(7);
    expect(items[0].total).toBe(7);
  });

  it("status name resolution: every count entry has a non-empty name", async () => {
    mockSequence(
      [makeRawRun(10)],
      [
        { testRunId: 10, statusId: 1, _count: { id: 5 } },
        { testRunId: 10, statusId: 2, _count: { id: 2 } },
      ],
      [
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
      ],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const items = structured(result).items as Array<{
      statusCounts: Array<{ id: number; name: string; count: number }>;
    }>;
    for (const entry of items[0].statusCounts) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name).not.toBe(String(entry.id));
    }
  });

  // ── Batched-call invariant + groupBy shape ───────────────────────────────

  it("batched-call invariant: ONE testRunCases.groupBy call regardless of page size", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => makeRawRun(i + 1));
    const groups = rows.map((r) => ({
      testRunId: r.id,
      statusId: 1,
      _count: { id: 1 },
    }));
    mockSequence(rows, groups, [{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });

    const groupByCalls = mockZenstack.mock.calls.filter(
      (c) => c[0] === "testRunCases" && c[1] === "groupBy",
    );
    expect(groupByCalls.length).toBe(1);
  });

  it("groupBy where shape uses testRunId.in: [...pageIds]", async () => {
    mockSequence(
      [makeRawRun(10), makeRawRun(20)],
      [],
      null,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });

    const body = getCallBody(1);
    const where = body?.where as Record<string, unknown>;
    expect(where.testRunId).toEqual({ in: [10, 20] });
    expect(body?.by).toEqual(["testRunId", "statusId"]);
    expect(body?._count).toEqual({ id: true });
  });

  it("groupBy result is split per run — no cross-pollination between rows", async () => {
    mockSequence(
      [makeRawRun(10), makeRawRun(20)],
      [
        { testRunId: 10, statusId: 1, _count: { id: 5 } },
        { testRunId: 20, statusId: 99, _count: { id: 4 } },
      ],
      [
        { id: 1, name: "Passed" },
        { id: 99, name: "WeirdStatus" },
      ],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const items = structured(result).items as Array<{
      id: number;
      statusCounts: Array<{ id: number }>;
    }>;
    const run10 = items.find((r) => r.id === 10)!;
    expect(run10.statusCounts.find((c) => c.id === 99)).toBeUndefined();
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  it("filter: stateId", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, stateId: 3 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.stateId).toBe(3);
    expect(where.projectId).toBe(7);
    expect(where.isDeleted).toBe(false);
  });

  it("filter: isCompleted=true", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, isCompleted: true },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(true);
  });

  it("filter: isCompleted=false (boolean false is forwarded too)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, isCompleted: false },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(false);
  });

  it("filter: createdById string", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, createdById: "user-42" },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.createdById).toBe("user-42");
  });

  it("filter: from + to date range", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: {
        projectId: 7,
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    const createdAt = where.createdAt as { gte: Date; lte: Date };
    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeInstanceOf(Date);
    expect(createdAt.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(createdAt.lte.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  it("pagination: hasNextPage TRUE when rows.length > limit; trimmed page in groupBy", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawRun(i + 1));
    const groups = rows.slice(0, 25).map((r) => ({
      testRunId: r.id,
      statusId: 1,
      _count: { id: 1 },
    }));
    mockSequence(rows, groups, [{ id: 1, name: "Passed" }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    const items = data.items as unknown[];
    expect(items.length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);

    // The groupBy page must contain only the trimmed 25 ids — NOT the probe.
    const groupByBody = getCallBody(1);
    const where = groupByBody?.where as Record<string, unknown>;
    expect((where.testRunId as { in: number[] }).in.length).toBe(25);
  });

  it("pagination: hasNextPage FALSE when rows.length <= limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRawRun(i + 1));
    mockSequence(
      rows,
      rows.map((r) => ({ testRunId: r.id, statusId: 1, _count: { id: 1 } })),
      [{ id: 1, name: "Passed" }],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    expect(data.hasNextPage).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  it("pagination: cursor + limit forwarded — take=limit+1, cursor={id}, skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.take).toBe(11);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
  });

  // ── DoS / safety ─────────────────────────────────────────────────────────

  it("DoS protection: limit > 100 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7, limit: 999 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("deterministic orderBy: [{createdAt:'desc'},{id:'desc'}]", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("always filters isDeleted: false", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  // ── Error paths ──────────────────────────────────────────────────────────

  it("error path: zenstack throws TestPlanItHttpError 422 on testRuns.findMany", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied by policy", {
        statusCode: 422,
        code: "POLICY_DENIAL",
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/422|Request failed/);
    expect(text).not.toMatch(/tpi_/);
  });

  it("error path: zenstack throws on the groupBy call — no partial response", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawRun(10)]);
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("groupBy boom", { statusCode: 500 }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    // Must not return a partial items[] with empty statusCounts as success.
    expect((result as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  it("error path: non-Http Error becomes 'Network or runtime error'", async () => {
    mockZenstack.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Network or runtime error");
  });

  it("token-redaction guard: tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_runs_list",
      arguments: { projectId: 7 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: name + description start, mentions statusCounts", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRunsList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_test_runs_list");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List test runs/);
    expect(tool?.description).toMatch(/statusCounts/);
  });
});
