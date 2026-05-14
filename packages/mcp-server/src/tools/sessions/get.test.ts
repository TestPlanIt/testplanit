import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerSessionsGet } from "./get.js";

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

function makeRawSessionResult(id = 1, overrides: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    elapsed: 60,
    resultData: proseDoc(`Step ${id} narrative`),
    status: { id: 1, name: "Passed" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    session: { id: 50, name: "Sprint 21 Session", projectId: 7 },
    ...overrides,
  };
}

interface RawSessionDetailOverrides {
  id?: number;
  name?: string;
  isCompleted?: boolean;
  completedAt?: string | null;
  createdAt?: string;
  mission?: unknown;
  note?: unknown;
  project?: { id: number; name: string };
  state?: { id: number; name: string };
  createdBy?: { id: string; name: string | null; email: string };
  assignedTo?: { id: string; name: string | null; email: string } | null;
  template?: { id: number; templateName: string } | null;
  configuration?: { id: number; name: string } | null;
  milestone?: { id: number; name: string } | null;
  tags?: Array<{ id: number; name: string }>;
  issues?: Array<unknown>;
  sessionResults?: Array<unknown>;
  sessionFieldValues?: Array<unknown>;
}

function makeRawSessionDetail(overrides: RawSessionDetailOverrides = {}) {
  return {
    id: 50,
    name: "Sprint 21 Session",
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    mission: proseDoc("Find auth bugs"),
    note: proseDoc("Session start note"),
    project: { id: 7, name: "P1" },
    state: { id: 3, name: "Active" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    assignedTo: null,
    template: { id: 4, templateName: "ExploratoryTemplate" },
    configuration: null,
    milestone: null,
    tags: [{ id: 1, name: "exploratory" }],
    issues: [],
    sessionResults: [],
    sessionFieldValues: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerSessionsGet(server, deps);
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

describe("registerSessionsGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path + denormalization ─────────────────────────────────────────

  it("happy path: full session detail with denormalized fields and inline sessionResults", async () => {
    const sessionResults = Array.from({ length: 5 }, (_, i) =>
      makeRawSessionResult(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({ sessionResults }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    // Header fields enumerated.
    expect(data.id).toBe(50);
    expect(data.name).toBe("Sprint 21 Session");
    expect(data.mission).toBe("Find auth bugs");
    expect(data.note).toBe("Session start note");
    expect(data.template).toEqual({ id: 4, name: "ExploratoryTemplate" });
    expect(data.tags).toEqual([{ id: 1, name: "exploratory" }]);
    expect(data.issues).toEqual([]);
    expect(data.customFields).toEqual({});
    expect(data.truncated).toBe(false);
    expect((data.sessionResults as unknown[]).length).toBe(5);
  });

  it("output keys: enumerates header + issues + customFields + sessionResults + truncated", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawSessionDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    const keys = new Set(Object.keys(data));
    for (const required of [
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
      "issues",
      "customFields",
      "sessionResults",
      "truncated",
    ]) {
      expect(keys.has(required)).toBe(true);
    }
  });

  // ── Truncation marker (D7-12) ────────────────────────────────────────────

  it("truncated false when sessionResults <= 100 (50 inline)", async () => {
    const sessionResults = Array.from({ length: 50 }, (_, i) =>
      makeRawSessionResult(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({ sessionResults }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    expect(data.truncated).toBe(false);
    expect((data.sessionResults as unknown[]).length).toBe(50);
  });

  it("truncated true when sessionResults > 100 (101 from take:101 cap)", async () => {
    // take:101 cap reveals overflow — 101 raw rows means truncation occurred.
    const sessionResults = Array.from({ length: 101 }, (_, i) =>
      makeRawSessionResult(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({ sessionResults }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    expect(data.truncated).toBe(true);
    // mapSessionDetail trims to 100 inline.
    expect((data.sessionResults as unknown[]).length).toBe(100);
  });

  // ── sessionResults shape uses mapSessionResultRow / mapSessionResultInline ─

  it("sessionResults inline shape: id, createdAt, status, createdBy, elapsed, session, resultDataText", async () => {
    const sessionResults = [makeRawSessionResult(1)];
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({ sessionResults }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    const sr = (data.sessionResults as Array<Record<string, unknown>>)[0];
    expect(Object.keys(sr).sort()).toEqual(
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
    expect(sr.id).toBe(1);
    expect(sr.resultDataText).toBe("Step 1 narrative");
    expect(sr.status).toEqual({ id: 1, name: "Passed" });
  });

  // ── Custom fields (sessionFieldValues -> denormalizeCustomFields) ────────

  it("custom fields: flat dict from sessionFieldValues for Text type", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({
        sessionFieldValues: [
          {
            value: "high",
            field: {
              displayName: "Severity",
              type: { type: "Text" },
              fieldOptions: [],
            },
          },
        ],
      }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    const customFields = data.customFields as Record<string, unknown>;
    expect(customFields["Severity"]).toBe("high");
  });

  it("custom fields: Dropdown option-id resolution to option name", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({
        sessionFieldValues: [
          {
            value: 7,
            field: {
              displayName: "Priority",
              type: { type: "Dropdown" },
              fieldOptions: [
                { fieldOption: { id: 7, name: "Critical" } },
                { fieldOption: { id: 8, name: "Minor" } },
              ],
            },
          },
        ],
      }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    const customFields = data.customFields as Record<string, unknown>;
    expect(customFields["Priority"]).toBe("Critical");
  });

  // ── Session-level issues with externalSystem from integration.provider ────

  it("issues: session-level linked issues — externalSystem comes from integration.provider", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({
        issues: [
          {
            id: 1,
            externalKey: "JIRA-1",
            title: "Some bug",
            externalStatus: "Open",
            integration: { provider: "JIRA" },
          },
        ],
      }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    const issues = data.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBe(1);
    expect(issues[0].externalKey).toBe("JIRA-1");
    expect(issues[0].externalSystem).toBe("JIRA");
  });

  // ── Mission and note via extractProseMirrorText ──────────────────────────

  it("mission and note extracted via extractProseMirrorText (PM doc -> plain string)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawSessionDetail({
        mission: proseDoc("Probe SSO edge cases"),
        note: proseDoc("Started 2pm"),
      }),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const data = structured(result);
    expect(data.mission).toBe("Probe SSO edge cases");
    expect(data.note).toBe("Started 2pm");
  });

  // ── Not-found path ───────────────────────────────────────────────────────

  it("session not found: zenstack returns null -> isError with session id in message", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Session");
    expect(text).toContain("999");
  });

  // ── Wire-shape: include sent to zenstack carries take:101 ────────────────

  it("wire shape: include.sessionResults.take === 101 (D7-12 verification)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawSessionDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const sessionResults = include?.sessionResults as Record<string, unknown>;
    expect(sessionResults.take).toBe(101);
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
      name: "testplanit_sessions_get",
      arguments: { sessionId: 50 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: testplanit_sessions_get exists with description starting with 'Fetch a single session'", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessionsGet(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_sessions_get");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^Fetch a single session/);
  });
});
