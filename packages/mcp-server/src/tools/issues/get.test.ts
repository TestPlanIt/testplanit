import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerIssuesGet } from "./get.js";

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

interface RawCase {
  id: number;
  name: string;
  source: string;
  automated: boolean;
}

interface RawSession {
  id: number;
  name: string;
  mission: unknown;
  isCompleted: boolean;
  state: { id: number; name: string } | null;
}

interface RawTestRun {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | null;
}

interface RawIssueDetail {
  id: number;
  projectId: number;
  externalKey: string;
  title: string | null;
  name: string | null;
  status: string | null;
  externalStatus: string | null;
  externalUrl: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  description: string | null;
  priority: string | null;
  issueTypeName: string | null;
  issueTypeIconUrl: string | null;
  note: unknown;
  integration: { id: number; name: string; provider: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count?: { repositoryCases: number };
  repositoryCases: RawCase[];
  sessions: RawSession[];
  testRuns: RawTestRun[];
}

function makeRawIssueDetail(
  overrides: Partial<RawIssueDetail> = {},
): RawIssueDetail {
  return {
    id: 42,
    projectId: 7,
    externalKey: "JIRA-42",
    title: "Big bug",
    name: null,
    status: "open",
    externalStatus: "In Progress",
    externalUrl: "https://example.atlassian.net/browse/JIRA-42",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSyncedAt: "2026-01-02T00:00:00.000Z",
    description: "There's a bug.",
    priority: "high",
    issueTypeName: "Bug",
    issueTypeIconUrl: "https://example/icon.png",
    note: proseDoc("hello"),
    integration: { id: 11, name: "Primary Jira", provider: "JIRA" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    _count: { repositoryCases: 6 },
    repositoryCases: [],
    sessions: [],
    testRuns: [],
    ...overrides,
  };
}

function makeRawCase(id: number): RawCase {
  return { id, name: `Case ${id}`, source: "MANUAL", automated: false };
}
function makeRawSession(id: number): RawSession {
  return {
    id,
    name: `Session ${id}`,
    mission: proseDoc(`mission ${id}`),
    isCompleted: false,
    state: { id: 3, name: "Active" },
  };
}
function makeRawTestRun(id: number): RawTestRun {
  return {
    id,
    name: `Run ${id}`,
    isCompleted: true,
    completedAt: "2026-02-01T00:00:00.000Z",
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesGet(server, deps);
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

describe("registerIssuesGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // 1. Happy path: all 3 linked arrays under cap
  it("happy path: all 3 linked arrays under cap, truncated is empty", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({
        repositoryCases: [makeRawCase(1), makeRawCase(2), makeRawCase(3), makeRawCase(4), makeRawCase(5)],
        sessions: [makeRawSession(1), makeRawSession(2), makeRawSession(3)],
        testRuns: [makeRawTestRun(1), makeRawTestRun(2)],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect((data.linkedCases as unknown[]).length).toBe(5);
    expect((data.linkedSessions as unknown[]).length).toBe(3);
    expect((data.linkedTestRuns as unknown[]).length).toBe(2);
    expect(data.truncated).toEqual({});
  });

  // 2. Truncates linkedCases when overflow
  it("truncates linkedCases when overflow (101 → 100, truncated.linkedCases=true)", async () => {
    const cases = Array.from({ length: 101 }, (_, i) => makeRawCase(i + 1));
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ repositoryCases: cases }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    expect((data.linkedCases as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).linkedCases).toBe(true);
  });

  // 3. Truncates linkedSessions when overflow
  it("truncates linkedSessions when overflow (101 → 100, truncated.linkedSessions=true)", async () => {
    const sessions = Array.from({ length: 101 }, (_, i) =>
      makeRawSession(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ sessions }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    expect((data.linkedSessions as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).linkedSessions).toBe(
      true,
    );
  });

  // 4. Truncates linkedTestRuns when overflow
  it("truncates linkedTestRuns when overflow (101 → 100, truncated.linkedTestRuns=true)", async () => {
    const testRuns = Array.from({ length: 101 }, (_, i) =>
      makeRawTestRun(i + 1),
    );
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ testRuns }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    expect((data.linkedTestRuns as unknown[]).length).toBe(100);
    expect((data.truncated as Record<string, unknown>).linkedTestRuns).toBe(
      true,
    );
  });

  // 5. Truncates all three at once
  it("truncates all three arrays at once (linkedCases + linkedSessions + linkedTestRuns)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({
        repositoryCases: Array.from({ length: 101 }, (_, i) => makeRawCase(i + 1)),
        sessions: Array.from({ length: 101 }, (_, i) => makeRawSession(i + 1)),
        testRuns: Array.from({ length: 101 }, (_, i) => makeRawTestRun(i + 1)),
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    const truncated = data.truncated as Record<string, unknown>;
    expect(truncated.linkedCases).toBe(true);
    expect(truncated.linkedSessions).toBe(true);
    expect(truncated.linkedTestRuns).toBe(true);
  });

  // 6. Extracts ProseMirror note to plain text
  it("extracts ProseMirror note to plain text via extractProseMirrorText", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ note: proseDoc("hello") }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    expect(data.note).toBe("hello");
  });

  // 7. Summary resolves title ?? name
  it("summary resolves title ?? name (title null → name fallback)", async () => {
    // title null → name fallback
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ title: null, name: "fallback" }),
    );
    const { client } = await setupClient();
    let result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    let data = structured(result);
    expect(data.summary).toBe("fallback");

    // title set → uses title
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({ title: "primary", name: "fallback" }),
    );
    result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    data = structured(result);
    expect(data.summary).toBe("primary");
  });

  // 8. externalSystem = integration.provider
  it("externalSystem = integration.provider (Pitfall 7)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawIssueDetail({
        integration: { id: 11, name: "GH", provider: "GITHUB" },
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const data = structured(result);
    expect(data.externalSystem).toBe("GITHUB");
  });

  // 9. Not found returns isError
  it("not found: zenstack returns null → isError with 'not found' text", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("not found");
  });

  // 10. Sub-include take is 101 (D7-12 overflow detection)
  it("sub-include take is 101 on all 3 sub-includes (D7-12 overflow detection)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawIssueDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, { take?: number }>;
    expect(include.repositoryCases.take).toBe(101);
    expect(include.sessions.take).toBe(101);
    expect(include.testRuns.take).toBe(101);
  });

  // 11. Sub-includes carry deterministic orderBy (Phase 7 MED-02 regression)
  it("sub-includes carry deterministic orderBy (Phase 7 MED-02 regression)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawIssueDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<
      string,
      { orderBy?: Array<Record<string, string>> }
    >;
    const expected = [{ createdAt: "desc" }, { id: "desc" }];
    expect(include.repositoryCases.orderBy).toEqual(expected);
    expect(include.sessions.orderBy).toEqual(expected);
    expect(include.testRuns.orderBy).toEqual(expected);
  });

  // 12. Soft-delete grep guard
  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE invariant)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawIssueDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
    // Each sub-include where carries isDeleted: false; main where also.
    const body = getCallBody(0);
    const where = body?.where as { isDeleted?: boolean };
    expect(where.isDeleted).toBe(false);
    const include = body?.include as Record<
      string,
      { where?: { isDeleted?: boolean } }
    >;
    expect(include.repositoryCases.where?.isDeleted).toBe(false);
    expect(include.sessions.where?.isDeleted).toBe(false);
    expect(include.testRuns.where?.isDeleted).toBe(false);
  });

  // 13. Token redaction at error boundary
  it("token redaction: tpi_*** does not leak in error path", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_get",
      arguments: { id: 42 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });
});
