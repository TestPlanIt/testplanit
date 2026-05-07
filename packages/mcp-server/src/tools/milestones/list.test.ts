import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerMilestonesList } from "./list.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawRow {
  id: number;
  name: string;
  isStarted: boolean;
  isCompleted: boolean;
  automaticCompletion: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  parentId: number | null;
  milestoneType: { id: number; name: string } | null;
  creator: { id: string; name: string | null; email: string } | null;
  _count?: { children: number; comments: number };
  testRuns?: Array<{ id: number }>;
  sessions?: Array<{ id: number }>;
}

function makeRow(id = 1, overrides: Partial<RawRow> = {}): RawRow {
  return {
    id,
    name: `M${id}`,
    isStarted: true,
    isCompleted: false,
    automaticCompletion: false,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    milestoneType: { id: 5, name: "Sprint" },
    creator: { id: "u1", name: "Alice", email: "a@b" },
    _count: { children: 0, comments: 0 },
    testRuns: [],
    sessions: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMilestonesList(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as
    | Record<string, unknown>
    | undefined;
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

/**
 * Mock the up-to-four zenstack calls plus the host CTE fetch:
 *  1. milestones.findMany       → rows
 *  2. testRunCases.groupBy      → runGroups (skipped when no runs)
 *  3. sessionResults.groupBy    → sessionGroups (skipped when no sessions)
 *  4. status.findMany           → statuses (skipped when no non-null statusIds)
 */
function mockSequence(
  rows: unknown[],
  runGroups: unknown[] | null = [],
  sessionGroups: unknown[] | null = [],
  statuses: unknown[] | null = [],
) {
  mockZenstack.mockResolvedValueOnce(rows);
  if (runGroups !== null) mockZenstack.mockResolvedValueOnce(runGroups);
  if (sessionGroups !== null) mockZenstack.mockResolvedValueOnce(sessionGroups);
  if (statuses !== null) mockZenstack.mockResolvedValueOnce(statuses);
}

describe("registerMilestonesList", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockZenstack.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
    // Default: host CTE returns no descendants (empty data map). Tests that
    // care about descendant counts override this with mockResolvedValueOnce.
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("happy path: 3 milestones with mixed pooled statusCounts each satisfy the SUM-to-total invariant", async () => {
    mockSequence(
      [
        makeRow(100, {
          testRuns: [{ id: 10 }],
          sessions: [{ id: 50 }],
        }),
        makeRow(101, {
          testRuns: [{ id: 11 }],
          sessions: [],
        }),
        makeRow(102, { testRuns: [], sessions: [{ id: 51 }] }),
      ],
      [
        // testRunCases groupBy
        { testRunId: 10, statusId: 1, _count: { id: 4 } },
        { testRunId: 10, statusId: null, _count: { id: 1 } },
        { testRunId: 11, statusId: 2, _count: { id: 3 } },
      ],
      [
        // sessionResults groupBy
        { sessionId: 50, statusId: 1, _count: { id: 2 } },
        { sessionId: 51, statusId: 1, _count: { id: 5 } },
      ],
      [
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
      ],
    );
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { "100": 7, "101": 0, "102": 2 } }),
        { status: 200 },
      ) as never,
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBeFalsy();
    const items = structured(result).items as Array<{
      id: number;
      statusCounts: Array<{ id: number; name: string; count: number }>;
      untested: number;
      total: number;
      totalDescendants: number;
      milestoneType: Record<string, unknown>;
    }>;
    expect(items).toHaveLength(3);
    for (const row of items) {
      const sum = row.statusCounts.reduce((s, c) => s + c.count, 0);
      expect(sum + row.untested).toBe(row.total);
    }
    // Milestone 100 sums: passed(4)+null(1) from runs + passed(2) from sessions = 7
    expect(items[0].id).toBe(100);
    expect(items[0].total).toBe(7);
    expect(items[0].untested).toBe(1);
    expect(items[0].totalDescendants).toBe(7);
    // Defensive: no icon leakage
    expect(items[0].milestoneType).not.toHaveProperty("iconName");
    expect(items[0].milestoneType).not.toHaveProperty("iconUrl");
    expect(items[0].milestoneType).not.toHaveProperty("icon");
  });

  it("parentId: null sets where.parentId === null (root-only)", async () => {
    mockSequence([], null, null, null);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, parentId: null },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where).toHaveProperty("parentId");
    expect(where.parentId).toBeNull();
  });

  it("parentId: 5 sets where.parentId === 5 (children-of)", async () => {
    mockSequence([], null, null, null);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, parentId: 5 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.parentId).toBe(5);
  });

  it("parentId omitted leaves no where.parentId key (all milestones)", async () => {
    mockSequence([], null, null, null);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("parentId");
  });

  it("pooled rollup uses TWO batched groupBy calls (testRunCases + sessionResults) with where.testRunId.in / where.sessionId.in", async () => {
    mockSequence(
      [
        makeRow(100, {
          testRuns: [{ id: 10 }, { id: 11 }],
          sessions: [{ id: 50 }],
        }),
      ],
      [{ testRunId: 10, statusId: 1, _count: { id: 1 } }],
      [{ sessionId: 50, statusId: 1, _count: { id: 1 } }],
      [{ id: 1, name: "Passed" }],
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });

    // Verify call 1 was milestones.findMany.
    expect(mockZenstack.mock.calls[0]?.[0]).toBe("milestones");
    expect(mockZenstack.mock.calls[0]?.[1]).toBe("findMany");

    // Verify call 2 was testRunCases.groupBy with where.testRunId.in.
    expect(mockZenstack.mock.calls[1]?.[0]).toBe("testRunCases");
    expect(mockZenstack.mock.calls[1]?.[1]).toBe("groupBy");
    const runBody = getCallBody(1) as {
      by: string[];
      where: { testRunId: { in: number[] } };
    };
    expect(runBody.by).toEqual(["testRunId", "statusId"]);
    expect(runBody.where.testRunId.in).toEqual([10, 11]);

    // Verify call 3 was sessionResults.groupBy with where.sessionId.in.
    expect(mockZenstack.mock.calls[2]?.[0]).toBe("sessionResults");
    expect(mockZenstack.mock.calls[2]?.[1]).toBe("groupBy");
    const sessionBody = getCallBody(2) as {
      by: string[];
      where: { sessionId: { in: number[] }; isDeleted: boolean };
    };
    expect(sessionBody.by).toEqual(["sessionId", "statusId"]);
    expect(sessionBody.where.sessionId.in).toEqual([50]);
    // Soft-delete defense in depth on the SessionResults nested where:
    expect(sessionBody.where.isDeleted).toBe(false);
  });

  it("page with zero runs and zero sessions skips both groupBy calls and the status findMany", async () => {
    // Only the milestones.findMany call should fire — no runs, no sessions,
    // no non-null status ids. The CTE fetch still runs to compute
    // totalDescendants for the page ids.
    mockZenstack.mockResolvedValueOnce([
      makeRow(100, { testRuns: [], sessions: [] }),
    ]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });

    // Exactly one zenstack call (milestones.findMany).
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(mockZenstack.mock.calls[0]?.[0]).toBe("milestones");
  });

  it("status.findMany skipped when nonNullStatusIds is empty (only null statusId in groups)", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRow(100, { testRuns: [{ id: 10 }], sessions: [] }),
    ]);
    mockZenstack.mockResolvedValueOnce([
      { testRunId: 10, statusId: null, _count: { id: 3 } },
    ]);
    // sessions empty → call 3 skipped → call 4 (status.findMany) skipped.

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });

    // Two zenstack calls: milestones + testRunCases.groupBy.
    expect(mockZenstack).toHaveBeenCalledTimes(2);
    expect(mockZenstack.mock.calls[1]?.[0]).toBe("testRunCases");
  });

  it("fetchDescendantCounts called exactly once per page with milestoneIds[] in the URL query", async () => {
    mockSequence(
      [makeRow(100), makeRow(101), makeRow(102)],
      null,
      null,
      null,
    );
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/mcp/milestones-descendants?q=");
    const qIndex = url.indexOf("?q=");
    const decoded = decodeURIComponent(url.slice(qIndex + 3));
    expect(JSON.parse(decoded)).toEqual({ milestoneIds: [100, 101, 102] });
  });

  it("Sigma counts + untested === total holds for every output item (SUM-to-total invariant)", async () => {
    mockSequence(
      [
        makeRow(100, {
          testRuns: [{ id: 10 }],
          sessions: [{ id: 50 }],
        }),
        makeRow(101, {
          testRuns: [{ id: 11 }],
          sessions: [],
        }),
      ],
      [
        { testRunId: 10, statusId: 1, _count: { id: 5 } },
        { testRunId: 10, statusId: 2, _count: { id: 2 } },
        { testRunId: 10, statusId: null, _count: { id: 1 } },
        { testRunId: 11, statusId: 1, _count: { id: 3 } },
      ],
      [{ sessionId: 50, statusId: 1, _count: { id: 4 } }],
      [
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
      ],
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_list",
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

  it("where.isDeleted === false on main where; nested testRuns and sessions sub-includes also stamp where.isDeleted: false", async () => {
    mockSequence([], null, null, null);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0) as Record<string, unknown>;
    const where = body.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
    const include = body.include as Record<string, Record<string, unknown>>;
    expect(
      (include.testRuns?.where as { isDeleted: boolean }).isDeleted,
    ).toBe(false);
    expect(
      (include.sessions?.where as { isDeleted: boolean }).isDeleted,
    ).toBe(false);
  });

  it("isCompleted boolean adds where.isCompleted; isStarted boolean adds where.isStarted", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, isCompleted: false, isStarted: true },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(false);
    expect(where.isStarted).toBe(true);
  });

  it("milestoneTypeId number sets where.milestoneTypesId (plural FK column from schema)", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, milestoneTypeId: 13 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.milestoneTypesId).toBe(13);
    // The singular form must NOT appear (schema uses plural).
    expect(where).not.toHaveProperty("milestoneTypeId");
  });

  it("createdById single string sets where.createdBy scalar (NOT where.creator relation)", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, createdById: "user_abc" },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.createdBy).toBe("user_abc");
    expect(where).not.toHaveProperty("creator");
  });

  it("from / to inputs map to where.createdAt with gte / lte Date instances", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: {
        projectId: 7,
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    const createdAt = where.createdAt as { gte?: unknown; lte?: unknown };
    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeInstanceOf(Date);
  });

  it("orderBy is exactly [{createdAt:'desc'}, {id:'desc'}]", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("cursor input maps to body.cursor === { id: cursor } and body.skip === 1", async () => {
    mockSequence([], null, null, null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, cursor: 99, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.cursor).toEqual({ id: 99 });
    expect(body?.skip).toBe(1);
    expect(body?.take).toBe(11); // limit + 1
  });

  it("take is limit + 1 for hasNextPage detection", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRow(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);
    mockZenstack.mockResolvedValueOnce([]); // testRunCases.groupBy (empty page rolls)
    // Note: with empty testRuns/sessions the page rolls trigger no further calls.

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);
  });

  it("DoS guard: limit > 100 rejected by zod and zenstack is never called", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_list",
      arguments: { projectId: 7, limit: 101 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });
});
