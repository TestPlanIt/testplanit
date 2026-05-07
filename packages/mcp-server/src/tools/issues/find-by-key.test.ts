import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerIssuesFindByKey } from "./find-by-key.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawIssueRow {
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
  integration: { id: number; name: string; provider: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count?: { repositoryCases: number };
}

function makeRawIssue(
  id = 1,
  overrides: Partial<RawIssueRow> = {},
): RawIssueRow {
  return {
    id,
    projectId: 7,
    externalKey: `JIRA-${id}`,
    title: `Issue ${id}`,
    name: null,
    status: "open",
    externalStatus: "In Progress",
    externalUrl: `https://example.atlassian.net/browse/JIRA-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSyncedAt: "2026-01-02T00:00:00.000Z",
    integration: { id: 11, name: "Primary Jira", provider: "JIRA" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    _count: { repositoryCases: 3 },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesFindByKey(server, deps);
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

describe("registerIssuesFindByKey", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── 0-match path ────────────────────────────────────────────────────────

  it("0 matches: isError with text containing 'not found'", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-999",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("not found");
  });

  // ── 1-match happy path ──────────────────────────────────────────────────

  it("1 match: returns { issue, multipleMatches: false } and externalKey echoes input", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawIssue(42)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-42",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.multipleMatches).toBe(false);
    const issue = data.issue as Record<string, unknown>;
    expect(issue.externalKey).toBe("JIRA-42");
    expect(issue.externalSystem).toBe("JIRA");
  });

  // ── multi-match fallback ────────────────────────────────────────────────

  it("2+ matches: { issues: [...], multipleMatches: true, hint }", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawIssue(1), makeRawIssue(2)]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-1",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.multipleMatches).toBe(true);
    const issues = data.issues as unknown[];
    expect(issues.length).toBe(2);
    expect(typeof data.hint).toBe("string");
    expect(data.hint).toContain("integrationId");
  });

  // ── integrationId narrows the where ─────────────────────────────────────

  it("integrationId narrows the where (body.where.integrationId asserted)", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawIssue(1)]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-1",
        externalSystem: "JIRA",
        projectId: 7,
        integrationId: 7,
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.integrationId).toBe(7);
  });

  // ── externalSystem maps to integration.provider filter ──────────────────

  it("externalSystem maps to integration.provider filter (not a top-level column)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-1",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    const where = getCallBody(0)?.where as {
      integration?: { provider?: string };
      externalSystem?: unknown;
    };
    expect(where.integration?.provider).toBe("JIRA");
    expect(where.externalSystem).toBeUndefined();
  });

  // ── mapper resolves externalSystem ──────────────────────────────────────

  it("mapper resolves externalSystem from integration.provider (Pitfall 7)", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawIssue(1, {
        integration: { id: 11, name: "GH", provider: "GITHUB" },
      }),
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "owner/repo#1",
        externalSystem: "GITHUB",
        projectId: 7,
      },
    });
    const data = structured(result);
    const issue = data.issue as Record<string, unknown>;
    expect(issue.externalSystem).toBe("GITHUB");
  });

  // ── soft-delete invariant grep guard ────────────────────────────────────

  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE invariant)", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawIssue(1)]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-1",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
    // Also the where always carries isDeleted: false
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
    // Verify findMany was the operation
    const target = getCallTarget(0);
    expect(target.op).toBe("findMany");
    expect(target.model).toBe("issue");
  });

  // ── token redaction at error boundary ───────────────────────────────────

  it("token redaction: tpi_*** does not leak in error path", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_find_by_key",
      arguments: {
        externalKey: "JIRA-1",
        externalSystem: "JIRA",
        projectId: 7,
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });
});
