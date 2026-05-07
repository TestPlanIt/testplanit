import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../../http.js";

vi.mock("../../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../../api.js";
import { registerSessionResultsList } from "./list.js";

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

interface RawSessionResultRow {
  id: number;
  createdAt: string;
  elapsed: number | null;
  resultData: unknown;
  status: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  session: { id: number; name: string; projectId: number } | null;
}

function makeRawResult(
  id = 1,
  overrides: Partial<RawSessionResultRow> = {},
): RawSessionResultRow {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    elapsed: 60,
    resultData: proseDoc(`Result ${id} narrative`),
    status: { id: 1, name: "Passed" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    session: { id: 50, name: "Sprint 21 Session", projectId: 7 },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerSessionResultsList(server, deps);
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

describe("registerSessionResultsList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path + mapped row shape ────────────────────────────────────────

  it("happy path: returns mapped row shape with denormalized status / createdBy / session / resultDataText", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawResult(10),
      makeRawResult(20),
      makeRawResult(30),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { sessionId: 50 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);

    expect(Object.keys(items[0]).sort()).toEqual(
      [
        "id",
        "createdAt",
        "elapsed",
        "resultDataText",
        "status",
        "createdBy",
        "session",
      ].sort(),
    );
    expect(items[0].id).toBe(10);
    expect(items[0].resultDataText).toBe("Result 10 narrative");
    expect(items[0].status).toEqual({ id: 1, name: "Passed" });
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  it("filter: sessionId — where.sessionId === N AND where.isDeleted === false", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { sessionId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.sessionId).toBe(7);
    expect(where.isDeleted).toBe(false);
  });

  it("filter: createdById string", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { createdById: "u-X" },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.createdById).toBe("u-X");
  });

  it("filter: statusId number", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { statusId: 5 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.statusId).toBe(5);
  });

  // ── R4 invariant — Pitfall 4 — SESS-03 schema-vs-requirements gap ────────

  it("R4 invariant / Pitfall 4: testCaseId NOT in the input schema; if passed via tool input it must NOT appear in where (SessionResults has no testCaseId column)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    // Zod's raw-shape inputSchema strips unknown fields. The tool must succeed
    // and NEVER forward testCaseId into the where literal — there is no such
    // column on SessionResults (R4 / Pitfall 4 / SESS-03 schema gap).
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { sessionId: 7, testCaseId: 99 } as Record<string, unknown>,
    });
    expect(result.isError).toBeFalsy();
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("testCaseId");
    expect(where.sessionId).toBe(7);
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  it("pagination: hasNextPage TRUE when rows.length > limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawResult(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: {},
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);
  });

  it("pagination: hasNextPage FALSE when rows.length <= limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRawResult(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: {},
    });
    const data = structured(result);
    expect(data.hasNextPage).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  it("pagination: cursor + limit forwarded — take=limit+1, cursor={id}, skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.take).toBe(11);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
  });

  // ── Determinism + soft-delete ─────────────────────────────────────────────

  it("BL-04 deterministic orderBy: [{createdAt:'desc'},{id:'desc'}]", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: {},
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("always filters isDeleted: false (SessionResults HAS the column)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_list",
      arguments: {},
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  // ── DoS / safety ─────────────────────────────────────────────────────────

  it("DoS protection (T-07-06): limit > 100 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: { limit: 999 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // ── Error paths ──────────────────────────────────────────────────────────

  it("error path: zenstack throws; tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_list",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: testplanit_session_results_list exists with description starting with 'List session results' AND mentions testCase-filter limitation (R4 / Pitfall 4)", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessionResultsList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_session_results_list",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List session results/);
    // R4 / Pitfall 4 — the description must document why testCase filtering
    // is unsupported (SessionResults has no testCaseId).
    expect(tool?.description).toMatch(/testCase/);
  });
});
