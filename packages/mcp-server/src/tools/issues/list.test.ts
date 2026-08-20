import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerIssuesList } from "./list.js";

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
  // RepositoryCases links are counted via the caseIssues join model now.
  _count?: { caseIssues: number };
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
    externalUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSyncedAt: null,
    integration: { id: 11, name: "Primary Jira", provider: "JIRA" },
    createdBy: { id: "u1", name: "Alice", email: "a@b" },
    _count: { caseIssues: 6 },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesList(server, deps);
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

describe("registerIssuesList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path with all 4 filters in the where body ─────────────────────

  it("all 4 filters appear in body.where (externalSystem, integrationId, status, externalStatus)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: {
        projectId: 7,
        externalSystem: "JIRA",
        integrationId: 7,
        status: "Open",
        externalStatus: "Done",
      },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.projectId).toBe(7);
    expect(where.isDeleted).toBe(false);
    expect((where.integration as { provider?: string }).provider).toBe("JIRA");
    expect(where.integrationId).toBe(7);
    expect(where.status).toBe("Open");
    expect(where.externalStatus).toEqual({
      contains: "Done",
      mode: "insensitive",
    });
  });

  // ── deterministic orderBy ───────────────────────────────────────────────

  it("deterministic orderBy [{createdAt:'desc'},{id:'desc'}]", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  // ── cursor round-trip ───────────────────────────────────────────────────

  it("cursor round-trip: body.cursor={id:cursor}, body.skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7, cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
    expect(body?.take).toBe(11); // limit + 1
  });

  // ── take = limit + 1 overflow ───────────────────────────────────────────

  it("take = limit + 1 overflow detection (hasNextPage true)", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawIssue(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    expect((data.items as unknown[]).length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    expect(data.nextCursor).toBe(25);
  });

  // ── linkedCaseCount surfaced in row shape ───────────────────────────────

  it("row shape includes linkedCaseCount via _count.caseIssues mapping", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawIssue(1, { _count: { caseIssues: 17 } }),
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0].linkedCaseCount).toBe(17);
  });

  // ── limit clamped at 100 ────────────────────────────────────────────────

  it("DoS guard: limit > 100 rejected by zod (zenstack not called)", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7, limit: 101 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // ── soft-delete grep guard ──────────────────────────────────────────────

  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE invariant)", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawIssue(1)]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  // ── token redaction ─────────────────────────────────────────────────────

  it("token redaction: tpi_*** does not leak in error path", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── requirement-role scope (HYG-01) ─────────────────────────────────────

  it("excludes requirements by default: where carries isRequirement === false", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isRequirement).toBe(false);
  });

  it("includeRequirements: true widens the query — where carries no isRequirement key", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7, includeRequirements: true },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect("isRequirement" in where).toBe(false);
  });

  it("includeRequirements: false behaves identically to omitting it", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: { projectId: 7, includeRequirements: false },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where.isRequirement).toBe(false);
  });

  it("the role predicate coexists with every other filter", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list",
      arguments: {
        projectId: 7,
        externalSystem: "JIRA",
        status: "Open",
        externalStatus: "Done",
        cursor: 100,
      },
    });
    const body = getCallBody(0);
    const where = body?.where as Record<string, unknown>;
    expect(where.isRequirement).toBe(false);
    expect((where.integration as { provider?: string }).provider).toBe(
      "JIRA",
    );
    expect(where.status).toBe("Open");
    expect(where.externalStatus).toEqual({
      contains: "Done",
      mode: "insensitive",
    });
    expect(body?.cursor).toEqual({ id: 100 });
  });

  it("the description states the requirement-exclusion default and the opt-in", async () => {
    const { client } = await setupClient();
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_issues_list",
    );
    expect(tool?.description).toMatch(/includeRequirements/);
  });
});
