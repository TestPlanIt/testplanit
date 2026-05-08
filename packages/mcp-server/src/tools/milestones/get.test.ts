import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerMilestonesGet } from "./get.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

const proseDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

interface RawTestRun {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | null;
}

interface RawSession {
  id: number;
  name: string;
  isCompleted: boolean;
  state: { id: number; name: string } | null;
}

interface RawChild {
  id: number;
  name: string;
  isCompleted: boolean;
  _count: { children: number };
}

interface RawDetail {
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
  note: unknown;
  docs: unknown;
  testRuns: RawTestRun[];
  sessions: RawSession[];
  children: RawChild[];
}

function makeRawDetail(overrides: Partial<RawDetail> = {}): RawDetail {
  return {
    id: 42,
    name: "Sprint 42",
    isStarted: true,
    isCompleted: false,
    automaticCompletion: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    milestoneType: { id: 5, name: "Sprint" },
    creator: { id: "u1", name: "Alice", email: "a@b" },
    _count: { children: 0, comments: 0 },
    note: null,
    docs: null,
    testRuns: [],
    sessions: [],
    children: [],
    ...overrides,
  };
}

function makeTestRun(id: number): RawTestRun {
  return {
    id,
    name: `Run ${id}`,
    isCompleted: false,
    completedAt: null,
  };
}

function makeSession(id: number): RawSession {
  return {
    id,
    name: `Session ${id}`,
    isCompleted: false,
    state: { id: 3, name: "Active" },
  };
}

function makeChild(id: number, childCount = 0): RawChild {
  return {
    id,
    name: `Child ${id}`,
    isCompleted: false,
    _count: { children: childCount },
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMilestonesGet(server, deps);
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

describe("registerMilestonesGet", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockZenstack.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
    // Default CTE response: empty data (every input id defaults to 0).
    // Implementation form returns a fresh Response for every call so the body
    // can be re-read across the self + children CTE invocations.
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("happy path: 5 testRuns, 3 sessions, 2 children returns full detail with empty truncated and child totalDescendants from second CTE call", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        testRuns: [
          makeTestRun(10),
          makeTestRun(11),
          makeTestRun(12),
          makeTestRun(13),
          makeTestRun(14),
        ],
        sessions: [makeSession(50), makeSession(51), makeSession(52)],
        children: [makeChild(200, 1), makeChild(201, 0)],
      }),
    );
    // testRuns.findMany (CR-02 — full rollup id set, milestoneId-scoped)
    mockZenstack.mockResolvedValueOnce([
      { id: 10 },
      { id: 11 },
      { id: 12 },
      { id: 13 },
      { id: 14 },
    ]);
    // sessions.findMany (CR-02)
    mockZenstack.mockResolvedValueOnce([
      { id: 50 },
      { id: 51 },
      { id: 52 },
    ]);
    // testRunCases.groupBy
    mockZenstack.mockResolvedValueOnce([
      { testRunId: 10, statusId: 1, _count: { id: 2 } },
    ]);
    // sessionResults.groupBy
    mockZenstack.mockResolvedValueOnce([
      { sessionId: 50, statusId: 1, _count: { id: 1 } },
    ]);
    // status.findMany
    mockZenstack.mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    fetchSpy.mockReset();
    // First CTE call — for the milestone itself.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { "42": 9 } }), { status: 200 }) as never,
    );
    // Second CTE call — for the direct children.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { "200": 4, "201": 0 } }),
        { status: 200 },
      ) as never,
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect((data.linkedTestRuns as unknown[]).length).toBe(5);
    expect((data.linkedSessions as unknown[]).length).toBe(3);
    expect((data.children as unknown[]).length).toBe(2);
    expect(data.truncated).toEqual({});
    expect(data.totalDescendants).toBe(9);
    const children = data.children as Array<{
      id: number;
      totalDescendants: number;
      directChildrenCount: number;
    }>;
    expect(children[0].id).toBe(200);
    expect(children[0].totalDescendants).toBe(4);
    expect(children[0].directChildrenCount).toBe(1);
    expect(children[1].totalDescendants).toBe(0);
    // Two CTE fetches per get: self + children.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("linkedTestRuns at exactly 250 raw rows produces no truncated.linkedTestRuns stamp and length stays 250", async () => {
    const testRuns = Array.from({ length: 250 }, (_, i) =>
      makeTestRun(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ testRuns }));
    // testRuns.findMany (CR-02) — same 250 ids
    mockZenstack.mockResolvedValueOnce(
      Array.from({ length: 250 }, (_, i) => ({ id: i + 1 })),
    );
    // sessions.findMany (CR-02) — none
    mockZenstack.mockResolvedValueOnce([]);
    // testRunCases.groupBy fires (250 ids)
    mockZenstack.mockResolvedValueOnce([]);
    // sessions empty → no sessionResults.groupBy. statuses skipped.

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.linkedTestRuns as unknown[]).length).toBe(250);
    expect((data.truncated as Record<string, unknown>).linkedTestRuns).toBeUndefined();
  });

  it("linkedTestRuns at 251 raw rows truncates to 250 and sets truncated.linkedTestRuns: true", async () => {
    const testRuns = Array.from({ length: 251 }, (_, i) =>
      makeTestRun(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ testRuns }));
    // testRuns.findMany (CR-02) — full 251 ids; rollup is computed against
    // the full set so totals stay correct even though linkedTestRuns is
    // trimmed for inline display.
    mockZenstack.mockResolvedValueOnce(
      Array.from({ length: 251 }, (_, i) => ({ id: i + 1 })),
    );
    // sessions.findMany (CR-02) — none
    mockZenstack.mockResolvedValueOnce([]);
    // testRunCases.groupBy
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.linkedTestRuns as unknown[]).length).toBe(250);
    expect((data.truncated as Record<string, unknown>).linkedTestRuns).toBe(true);
  });

  it("linkedSessions at exactly 100 raw rows produces no truncated.linkedSessions stamp", async () => {
    const sessions = Array.from({ length: 100 }, (_, i) =>
      makeSession(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ sessions }));
    // testRuns.findMany (CR-02) — none
    mockZenstack.mockResolvedValueOnce([]);
    // sessions.findMany (CR-02) — same 100 ids
    mockZenstack.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
    );
    // No runs → testRunCases.groupBy skipped. sessions present → sessionResults.groupBy.
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.linkedSessions as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).linkedSessions).toBeUndefined();
  });

  it("linkedSessions at 101 raw rows truncates to 100 and sets truncated.linkedSessions: true", async () => {
    const sessions = Array.from({ length: 101 }, (_, i) =>
      makeSession(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ sessions }));
    // testRuns.findMany (CR-02) — none
    mockZenstack.mockResolvedValueOnce([]);
    // sessions.findMany (CR-02) — full 101 ids; rollup uses the full set.
    mockZenstack.mockResolvedValueOnce(
      Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })),
    );
    // sessionResults.groupBy
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.linkedSessions as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).linkedSessions).toBe(true);
  });

  it("children at exactly 100 raw rows produces no truncated.children stamp", async () => {
    const children = Array.from({ length: 100 }, (_, i) => makeChild(i + 1));
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ children }));
    // no runs, no sessions → no rollup calls.

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.children as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).children).toBeUndefined();
  });

  it("children at 101 raw rows truncates to 100 and sets truncated.children: true", async () => {
    const children = Array.from({ length: 101 }, (_, i) => makeChild(i + 1));
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ children }));

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect((data.children as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).children).toBe(true);
  });

  it("note: null and docs: null both extract to empty string via extractProseMirrorText", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({ note: null, docs: null }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect(data.note).toBe("");
    expect(data.docs).toBe("");
  });

  it("note as ProseMirror doc returns the extracted plain text", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        note: proseDoc("Hello note"),
        docs: proseDoc("Some docs"),
      }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect(data.note).toBe("Hello note");
    expect(data.docs).toBe("Some docs");
  });

  it("findUnique returning null produces isError true with text 'Milestone N not found.'", async () => {
    mockZenstack.mockResolvedValueOnce(null);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toBe("Milestone 999 not found.");
  });

  it("soft-delete defense: zenstack findUnique body.where stamps id and isDeleted: false", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const body = getCallBody(0) as Record<string, unknown>;
    expect(body.where).toEqual({ id: 42, isDeleted: false });
  });

  it("exactly TWO CTE fetch calls per request — one for self, one batched across children IDs", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        children: [makeChild(200), makeChild(201), makeChild(202)],
      }),
    );

    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { "42": 5 } }), { status: 200 }) as never,
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { "200": 1, "201": 0, "202": 2 } }),
        { status: 200 },
      ) as never,
    );

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Second call carries milestoneIds = children ids.
    const url2 = fetchSpy.mock.calls[1]?.[0] as string;
    const qIndex = url2.indexOf("?q=");
    const decoded = decodeURIComponent(url2.slice(qIndex + 3));
    expect(JSON.parse(decoded)).toEqual({
      milestoneIds: [200, 201, 202],
    });
  });

  it("response shape contains pooled statusCounts and the milestoneType has no icon key", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestones_get",
      arguments: { milestoneId: 42 },
    });
    const data = structured(result);
    expect(data).toHaveProperty("statusCounts");
    expect(data).toHaveProperty("untested");
    expect(data).toHaveProperty("total");
    const mt = data.milestoneType as Record<string, unknown>;
    expect(mt).toEqual({ id: 5, name: "Sprint" });
    expect(mt).not.toHaveProperty("iconName");
    expect(mt).not.toHaveProperty("iconUrl");
    expect(mt).not.toHaveProperty("icon");
  });
});
