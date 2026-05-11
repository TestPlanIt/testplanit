import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerSessionsFindings } from "./findings.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawFinding {
  id: number;
  externalKey: string | null;
  title: string | null;
  status: string | null;
  externalStatus: string | null;
  priority: string | null;
  integration: { provider: string } | null;
}

function makeRawFinding(
  id = 1,
  overrides: Partial<RawFinding> = {},
): RawFinding {
  return {
    id,
    externalKey: `JIRA-${id}`,
    title: `Issue ${id}`,
    status: "open",
    externalStatus: "In Progress",
    priority: "high",
    integration: { provider: "JIRA" },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerSessionsFindings(server, deps);
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

describe("registerSessionsFindings", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── sessionId mode happy path ───────────────────────────────────────────

  it("sessionId mode happy path: returns { session: {id,name}, findings: Issue[], truncated:false }", async () => {
    // First call: issue findMany (returns 3 findings).
    mockZenstack.mockResolvedValueOnce([
      makeRawFinding(1),
      makeRawFinding(2),
      makeRawFinding(3),
    ]);
    // Second call: sessions findUnique.
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "Login regression" });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.session).toEqual({ id: 7, name: "Login regression" });
    const findings = data.findings as Array<Record<string, unknown>>;
    expect(findings.length).toBe(3);
    // Each finding has the mapFinding shape.
    expect(Object.keys(findings[0]).sort()).toEqual(
      [
        "id",
        "externalKey",
        "title",
        "status",
        "externalStatus",
        "priority",
        "externalSystem",
      ].sort(),
    );
    expect(findings[0].externalSystem).toBe("JIRA");
    expect(data.truncated).toBe(false);
  });

  // ── sessionId mode: where.OR contains both branches (D7-11) ─────────────

  it("sessionId mode: where.OR contains [{sessions.some.id}, {sessionResults.some.session.id}] per D7-11", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "Test session" });

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    const body = getCallBody(0);
    const where = body?.where as Record<string, unknown>;
    expect(where.OR).toEqual([
      { sessions: { some: { id: 7 } } },
      { sessionResults: { some: { session: { id: 7 } } } },
    ]);
    expect(where.isDeleted).toBe(false);
  });

  // ── sessionId mode deterministic orderBy ─────────────────────────────────

  it("sessionId mode: deterministic orderBy [{createdAt:'desc'},{id:'desc'}]", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "S" });

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  // ── sessionId mode truncated marker (T-07-06) ────────────────────────────

  it("sessionId mode: truncated:true when issue findMany returns more than 500 (T-07-06 cap)", async () => {
    // Mock returns 501 — overflow detected via take:501 cap.
    const findings = Array.from({ length: 501 }, (_, i) => makeRawFinding(i + 1));
    mockZenstack.mockResolvedValueOnce(findings);
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "S" });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    const data = structured(result);
    expect(data.truncated).toBe(true);
    expect((data.findings as unknown[]).length).toBe(500);
  });

  it("sessionId mode: truncated:false when 100 returned", async () => {
    const findings = Array.from({ length: 100 }, (_, i) => makeRawFinding(i + 1));
    mockZenstack.mockResolvedValueOnce(findings);
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "S" });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    const data = structured(result);
    expect(data.truncated).toBe(false);
    expect((data.findings as unknown[]).length).toBe(100);
  });

  // ── sessionId mode: session not found ────────────────────────────────────

  it("sessionId mode: session not found -> isError with sessionId in message", async () => {
    mockZenstack.mockResolvedValueOnce([]); // issues findMany
    mockZenstack.mockResolvedValueOnce(null); // sessions findUnique returns null

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Session");
    expect(text).toContain("999");
  });

  // ── issueId mode happy path ──────────────────────────────────────────────

  it("issueId mode happy path: returns { issue, linkedSessions, linkedSessionResults }", async () => {
    mockZenstack.mockResolvedValueOnce({
      id: 42,
      externalKey: "JIRA-1",
      title: "Bug",
      status: "open",
      externalStatus: "In Progress",
      priority: "high",
      integration: { provider: "JIRA" },
      sessions: [
        {
          id: 50,
          name: "Sprint 21 Session",
          createdAt: "2026-01-01T00:00:00.000Z",
          isCompleted: false,
          createdBy: { id: "u1", name: "Alice", email: "a@b" },
        },
      ],
      sessionResults: [
        {
          id: 100,
          sessionId: 50,
          createdAt: "2026-01-01T01:00:00.000Z",
          status: { id: 1, name: "Failed" },
          createdBy: { id: "u1", name: "Alice", email: "a@b" },
        },
      ],
    });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { issueId: 42 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const issue = data.issue as Record<string, unknown>;
    expect(issue.id).toBe(42);
    expect(issue.externalSystem).toBe("JIRA");
    const linkedSessions = data.linkedSessions as Array<
      Record<string, unknown>
    >;
    expect(linkedSessions.length).toBe(1);
    expect(linkedSessions[0]).toEqual({
      id: 50,
      name: "Sprint 21 Session",
      createdAt: "2026-01-01T00:00:00.000Z",
      isCompleted: false,
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
    });
    const linkedSessionResults = data.linkedSessionResults as Array<
      Record<string, unknown>
    >;
    expect(linkedSessionResults.length).toBe(1);
    expect(linkedSessionResults[0]).toEqual({
      id: 100,
      sessionId: 50,
      createdAt: "2026-01-01T01:00:00.000Z",
      status: { id: 1, name: "Failed" },
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
    });
  });

  // ── issueId mode: issue not found ────────────────────────────────────────

  it("issueId mode: issue not found -> isError with issueId in message", async () => {
    mockZenstack.mockResolvedValueOnce(null);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { issueId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Issue");
    expect(text).toContain("999");
  });

  // ── issueId mode: zenstack call shape uses issue findUnique ──────────────

  it("issueId mode: calls zenstack('issue', 'findUnique', ...) with linkedSessions / linkedSessionResults includes", async () => {
    mockZenstack.mockResolvedValueOnce({
      id: 42,
      externalKey: "K",
      title: "T",
      status: null,
      externalStatus: null,
      priority: null,
      integration: null,
      sessions: [],
      sessionResults: [],
    });

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { issueId: 42 },
    });
    const target = getCallTarget(0);
    expect(target.model).toBe("issue");
    expect(target.op).toBe("findUnique");
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    expect(include).toHaveProperty("sessions");
    expect(include).toHaveProperty("sessionResults");
    expect(include).toHaveProperty("integration");
  });

  // ── XOR validation ───────────────────────────────────────────────────────

  it("XOR: neither sessionId nor issueId provided -> isError with 'exactly one'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("XOR: both sessionId and issueId provided -> isError with 'exactly one'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7, issueId: 42 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // ── isDeleted:false applied across modes ─────────────────────────────────

  it("sessionId mode: where.isDeleted: false (Issue.isDeleted)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    mockZenstack.mockResolvedValueOnce({ id: 7, name: "S" });

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  it("issueId mode: linkedSessions / linkedSessionResults includes carry isDeleted: false", async () => {
    mockZenstack.mockResolvedValueOnce({
      id: 42,
      externalKey: "K",
      title: "T",
      status: null,
      externalStatus: null,
      priority: null,
      integration: null,
      sessions: [],
      sessionResults: [],
    });
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { issueId: 42 },
    });
    const include = (getCallBody(0)?.include ?? {}) as Record<string, unknown>;
    const linkedSessions = include.sessions as Record<string, unknown>;
    const linkedSessionResults = include.sessionResults as Record<
      string,
      unknown
    >;
    expect((linkedSessions.where as Record<string, unknown>).isDeleted).toBe(
      false,
    );
    expect(
      (linkedSessionResults.where as Record<string, unknown>).isDeleted,
    ).toBe(false);
  });

  // ── Error path / token redaction ─────────────────────────────────────────

  it("error path: zenstack throws; tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_findings_list",
      arguments: { sessionId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: testplanit_sessions_findings_list exists with description noting both modes and XOR requirement", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessionsFindings(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_sessions_findings_list",
    );
    expect(tool).toBeDefined();
    // Description must mention sessionId and issueId modes plus XOR semantics.
    expect(tool?.description).toMatch(/sessionId/);
    expect(tool?.description).toMatch(/issueId/);
    expect(tool?.description?.toLowerCase()).toMatch(/exactly one|xor/);
  });
});
