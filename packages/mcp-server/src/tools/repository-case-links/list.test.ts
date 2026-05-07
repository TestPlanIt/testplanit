import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRepositoryCaseLinksList } from "./list.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawCase {
  id: number;
  name: string;
  source: string;
  automated: boolean;
}

interface RawLinkRow {
  id: number;
  type: string;
  createdAt: string | Date;
  caseA: RawCase | null;
  caseB: RawCase | null;
  createdBy: { id: string; name: string | null; email: string } | null;
}

function makeCase(id: number, overrides: Partial<RawCase> = {}): RawCase {
  return {
    id,
    name: `Case ${id}`,
    source: "MANUAL",
    automated: false,
    ...overrides,
  };
}

function makeRow(
  id: number,
  caseAId: number,
  caseBId: number,
  overrides: Partial<RawLinkRow> = {},
): RawLinkRow {
  return {
    id,
    type: "SAME_TEST_DIFFERENT_SOURCE",
    createdAt: "2026-01-01T00:00:00.000Z",
    caseA: makeCase(caseAId),
    caseB: makeCase(caseBId),
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRepositoryCaseLinksList(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
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
  return mockZenstack.mock.calls[index]?.[2] as
    | Record<string, unknown>
    | undefined;
}

function getCallTarget(index: number) {
  const call = mockZenstack.mock.calls[index];
  return { model: call?.[0] as string, op: call?.[1] as string };
}

describe("registerRepositoryCaseLinksList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── XOR validation (tests 1-3) ─────────────────────────────────────────────

  it("XOR: empty input -> isError 'Provide exactly one'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("XOR: caseId + caseAId together -> isError", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 1, caseAId: 2 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("XOR: caseAId + caseBId together -> isError", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 1, caseBId: 2 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // ── Where clause shape (tests 4-6) ─────────────────────────────────────────

  it("caseId mode: where.OR === [{caseAId}, {caseBId}] and no top-level caseAId/caseBId", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 42 },
    });
    const body = getCallBody(0) as { where: { OR?: unknown[] } };
    expect(body.where.OR).toEqual([
      { caseAId: 42 },
      { caseBId: 42 },
    ]);
    expect(body.where).not.toHaveProperty("caseAId");
    expect(body.where).not.toHaveProperty("caseBId");
  });

  it("caseAId mode: where.caseAId set, no OR clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 42 },
    });
    const body = getCallBody(0) as { where: Record<string, unknown> };
    expect(body.where.caseAId).toBe(42);
    expect(body.where).not.toHaveProperty("OR");
  });

  it("caseBId mode: where.caseBId set, no OR clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseBId: 42 },
    });
    const body = getCallBody(0) as { where: Record<string, unknown> };
    expect(body.where.caseBId).toBe(42);
    expect(body.where).not.toHaveProperty("OR");
  });

  // ── linkType filter + isDeleted (tests 7-8) ────────────────────────────────

  it("linkType filter applied -> where.type === 'SAME_TEST_DIFFERENT_SOURCE'", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 42, linkType: "SAME_TEST_DIFFERENT_SOURCE" },
    });
    const body = getCallBody(0) as { where: Record<string, unknown> };
    expect(body.where.type).toBe("SAME_TEST_DIFFERENT_SOURCE");
  });

  it("always filters where.isDeleted: false", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7 },
    });
    const body = getCallBody(0) as { where: Record<string, unknown> };
    expect(body.where.isDeleted).toBe(false);
  });

  // ── Mapper behaviour (tests 9-11) ──────────────────────────────────────────

  it("caseId mode mapper: when caseA.id === queriedId, otherCase = caseB", async () => {
    // Row where caseA.id === 42, caseB.id === 100 — so otherCase should be caseB.
    mockZenstack.mockResolvedValueOnce([makeRow(1, 42, 100)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 42 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
    expect(items[0]).not.toHaveProperty("caseA");
    expect(items[0]).not.toHaveProperty("caseB");
    expect(items[0].otherCase).toEqual({
      id: 100,
      name: "Case 100",
      source: "MANUAL",
      automated: false,
    });
  });

  it("caseId mode mapper: when caseB.id === queriedId, otherCase = caseA", async () => {
    // Row where caseA.id === 100, caseB.id === 42 — so otherCase should be caseA.
    mockZenstack.mockResolvedValueOnce([makeRow(1, 100, 42)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 42 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0].otherCase).toEqual({
      id: 100,
      name: "Case 100",
      source: "MANUAL",
      automated: false,
    });
  });

  it("caseAId mode mapper: returns directional shape with both caseA and caseB", async () => {
    mockZenstack.mockResolvedValueOnce([makeRow(1, 42, 100)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 42 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).not.toHaveProperty("otherCase");
    expect(items[0].caseA).toEqual({
      id: 42,
      name: "Case 42",
      source: "MANUAL",
      automated: false,
    });
    expect(items[0].caseB).toEqual({
      id: 100,
      name: "Case 100",
      source: "MANUAL",
      automated: false,
    });
  });

  // ── Pagination (tests 12-13) ───────────────────────────────────────────────

  it("pagination: cursor + limit forwarded; take=limit+1; cursor={id}, skip=1; hasNextPage detected", async () => {
    // 11 rows returned for limit=10 -> hasNextPage:true, items trimmed to 10.
    const rows = Array.from({ length: 11 }, (_, i) => makeRow(i + 1, i + 1, 999));
    mockZenstack.mockResolvedValueOnce(rows);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7, cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.take).toBe(11);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(10);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(10);
  });

  it("limit clamped at 100 — limit=101 rejected by zod", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7, limit: 101 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // ── Tool wiring (test 14) ──────────────────────────────────────────────────

  it("calls zenstack('repositoryCaseLink', 'findMany', ...) — camelCase singular model name", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7 },
    });
    const target = getCallTarget(0);
    expect(target.model).toBe("repositoryCaseLink");
    expect(target.op).toBe("findMany");
  });

  // ── Soft-delete invariant (test 15) ────────────────────────────────────────

  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7 },
    });
    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
  });

  // ── Token redaction (test 16) ──────────────────────────────────────────────

  it("error path: zenstack throws; tpi_ token does not leak", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseAId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Pitfall 4 regression (test 17) ─────────────────────────────────────────

  it("never includes a project-id field in the zenstack call body", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_repository_case_links_list",
      arguments: { caseId: 42, linkType: "DEPENDS_ON", limit: 5 },
    });
    const body = getCallBody(0);
    expect(JSON.stringify(body)).not.toContain("projectId");
  });

  // ── Tool registration sanity ───────────────────────────────────────────────

  it("tool is registered with description noting XOR semantics over caseId / caseAId / caseBId", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRepositoryCaseLinksList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_repository_case_links_list",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/caseId/);
    expect(tool?.description).toMatch(/caseAId/);
    expect(tool?.description).toMatch(/caseBId/);
    expect(tool?.description?.toLowerCase()).toMatch(/exactly one/);
  });
});
