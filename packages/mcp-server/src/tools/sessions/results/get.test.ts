import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../../http.js";

vi.mock("../../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../../api.js";
import { registerSessionResultsGet } from "./get.js";

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

interface RawSessionResultDetailOverrides {
  id?: number;
  createdAt?: string;
  elapsed?: number | null;
  resultData?: unknown;
  status?: { id: number; name: string } | null;
  createdBy?: { id: string; name: string | null; email: string } | null;
  session?: { id: number; name: string; projectId: number } | null;
  attachments?: Array<unknown>;
  issues?: Array<unknown>;
  resultFieldValues?: Array<unknown>;
}

function makeRawDetail(overrides: RawSessionResultDetailOverrides = {}) {
  return {
    id: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    elapsed: 60,
    resultData: proseDoc("Result narrative"),
    status: { id: 1, name: "Passed" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    session: { id: 50, name: "Sprint 21 Session", projectId: 7 },
    attachments: [],
    issues: [],
    resultFieldValues: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerSessionResultsGet(server, deps);
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

describe("registerSessionResultsGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path + full detail ─────────────────────────────────────────────

  it("happy path: returns full session-result detail with denormalized status / createdBy / session / customFields / attachments / issues / resultDataText", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.id).toBe(1);
    expect(data.elapsed).toBe(60);
    expect(data.resultDataText).toBe("Result narrative");
    expect(data.status).toEqual({ id: 1, name: "Passed" });
    expect(data.createdBy).toEqual({ id: "u1", name: "Alice", email: "a@b" });
    expect(data.session).toEqual({
      id: 50,
      name: "Sprint 21 Session",
      projectId: 7,
    });
    expect(data.customFields).toEqual({});
    expect(data.attachments).toEqual([]);
    expect(data.issues).toEqual([]);
  });

  // ── createdBy IS the executor (D7-13) ────────────────────────────────────

  it("D7-13: createdBy IS the executor — output has NO separate executedBy field", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    // Sessions don't have a separate executor field; createdBy carries the executor.
    expect(data.createdBy).toEqual({ id: "u1", name: "Alice", email: "a@b" });
    expect(data).not.toHaveProperty("executedBy");
  });

  // ── NO step-level results (D7-13) ────────────────────────────────────────

  it("D7-13: NO step-level results — output has NO stepResults key (sessions are exploratory and not stepwise)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data).not.toHaveProperty("stepResults");
  });

  // ── Output keys enumerated ───────────────────────────────────────────────

  it("output keys: enumerates id / createdAt / elapsed / resultDataText / status / createdBy / session / customFields / attachments / issues", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(Object.keys(data).sort()).toEqual(
      [
        "id",
        "createdAt",
        "elapsed",
        "resultDataText",
        "status",
        "createdBy",
        "session",
        "customFields",
        "attachments",
        "issues",
      ].sort(),
    );
  });

  // ── Custom fields denormalization (Dropdown -> name resolution) ──────────

  it("custom fields: Dropdown option-id resolution to option name via denormalizeResultFieldValues", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        resultFieldValues: [
          {
            value: 7,
            field: {
              displayName: "Severity",
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
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const customFields = data.customFields as Record<string, unknown>;
    expect(customFields["Severity"]).toBe("Critical");
  });

  // ── resultDataText extracted via extractProseMirrorText ──────────────────

  it("resultDataText extracted via extractProseMirrorText (PM doc -> plain string)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        resultData: proseDoc("Probed login flow"),
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.resultDataText).toBe("Probed login flow");
  });

  // ── attachments shape ────────────────────────────────────────────────────

  it("attachments shape: { id, fileName, url } (raw.name -> output fileName)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        attachments: [{ id: 11, name: "screen.png", url: "https://x/1" }],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.attachments).toEqual([
      { id: 11, fileName: "screen.png", url: "https://x/1" },
    ]);
  });

  // ── issues with externalSystem from integration.provider ─────────────────

  it("issues: externalSystem comes from integration.provider", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
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
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const issues = data.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBe(1);
    expect(issues[0].externalKey).toBe("JIRA-1");
    expect(issues[0].externalSystem).toBe("JIRA");
  });

  // ── Not-found path (T-07-02 IDOR) ────────────────────────────────────────

  it("session result not found: zenstack returns null -> isError with 'Session result' and resultId in message", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Session result");
    expect(text).toContain("999");
  });

  // ── Wire-shape: include sent to zenstack uses SESSION_RESULT_DETAIL_INCLUDE
  //              (verifies we go via findUnique with the documented include) ─

  it("wire shape: include carries resultFieldValues (SESSION_RESULT_DETAIL_INCLUDE)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    expect(include).toHaveProperty("resultFieldValues");
    expect(include).toHaveProperty("attachments");
    expect(include).toHaveProperty("issues");
    expect(include).toHaveProperty("status");
    expect(include).toHaveProperty("createdBy");
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
      name: "testplanit_session_results_get",
      arguments: { resultId: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: testplanit_session_results_get exists with description starting with 'Fetch a single session result' AND mentions 'no step-level' (D7-13)", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSessionResultsGet(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_session_results_get",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^Fetch a single session result/);
    // D7-13: description must document no-step-level-results.
    expect(tool?.description).toMatch(/no step-level/);
  });
});
