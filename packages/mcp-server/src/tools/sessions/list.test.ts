import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerSessionsList } from "./list.js";

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

interface RawSessionRow {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
  mission: unknown;
  note: unknown;
  project: { id: number; name: string };
  state: { id: number; name: string };
  createdBy: { id: string; name: string | null; email: string };
  assignedTo: { id: string; name: string | null; email: string } | null;
  template: { id: number; templateName: string } | null;
  configuration: { id: number; name: string } | null;
  milestone: { id: number; name: string } | null;
  tags: Array<{ id: number; name: string }>;
}

function makeRawSession(
  id = 1,
  overrides: Partial<RawSessionRow> = {},
): RawSessionRow {
  return {
    id,
    name: `Session ${id}`,
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    mission: proseDoc("Find auth bugs"),
    note: proseDoc("Started at 9am"),
    project: { id: 7, name: "P1" },
    state: { id: 3, name: "Active" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    assignedTo: null,
    template: { id: 4, templateName: "ExploratoryTemplate" },
    configuration: null,
    milestone: null,
    tags: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerSessionsList(server, deps);
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

describe("registerSessionsList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("happy path: returns mapped row shape with denormalized fields and PM-extracted mission/note", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawSession(10),
      makeRawSession(20),
      makeRawSession(30),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);

    expect(Object.keys(items[0]).sort()).toEqual(
      [
        "id",
        "name",
        "isCompleted",
        "completedAt",
        "createdAt",
        "mission",
        "note",
        "project",
        "state",
        "createdBy",
        "assignedTo",
        "template",
        "configuration",
        "milestone",
        "tags",
      ].sort(),
    );

    expect(items[0].mission).toBe("Find auth bugs");
    expect(items[0].note).toBe("Started at 9am");
    expect(items[0].template).toEqual({ id: 4, name: "ExploratoryTemplate" });
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  it("filter: stateId", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_list",
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
      name: "testplanit_sessions_list",
      arguments: { projectId: 7, isCompleted: true },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(true);
  });

  it("filter: isCompleted=false (boolean false is forwarded too)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_list",
      arguments: { projectId: 7, isCompleted: false },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isCompleted).toBe(false);
  });

  it("filter: createdById string", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_list",
      arguments: { projectId: 7, createdById: "user-X" },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.createdById).toBe("user-X");
  });

  it("filter: from + to date range — round-trips through Date()", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_list",
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

  it("pagination: hasNextPage TRUE when rows.length > limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawSession(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);
  });

  it("pagination: hasNextPage FALSE when rows.length <= limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRawSession(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_list",
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
      name: "testplanit_sessions_list",
      arguments: { projectId: 7, cursor: 100, limit: 10 },
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
      name: "testplanit_sessions_list",
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
      name: "testplanit_sessions_list",
      arguments: { projectId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  // ── DoS / safety ─────────────────────────────────────────────────────────

  it("DoS protection: limit > 100 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_list",
      arguments: { projectId: 7, limit: 999 },
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
      name: "testplanit_sessions_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: testplanit_sessions_list exists with description starting with 'List sessions'", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessionsList(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_sessions_list");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List sessions/);
  });
});
