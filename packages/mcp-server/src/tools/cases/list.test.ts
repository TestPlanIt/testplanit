import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCasesList } from "./list.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

function makeRawRow(overrides: Record<string, unknown> = {}, id = 1) {
  return {
    id,
    name: `Case ${id}`,
    source: "MANUAL",
    automated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: { id: 7, name: "TestProject" },
    folder: { id: 12, name: "Auth", parentId: 5 },
    state: { id: 3, name: "Active" },
    creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
    // Raw rows carry tags through the RepositoryCaseTag join (caseTags[].tag);
    // mapCaseRow flattens them to the tags[] output shape.
    caseTags: [{ tag: { id: 1, name: "smoke" } }],
    ...overrides,
  };
}

/** Helper: create a server, register the tool, connect a client, and return both */
async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesList(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

/**
 * Parse the `?q=` query from the last zenstack call's body argument.
 * In list.ts, we pass the body directly to zenstack — the mock captures
 * the third argument (body) directly.
 */
function getLastCallBody() {
  const calls = mockZenstack.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][2] as Record<string, unknown>;
}

describe("registerCasesList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: returns mapped row shape for items", async () => {
    const rows = [makeRawRow({}, 1), makeRawRow({}, 2), makeRawRow({}, 3)];
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const items = (structured as { items: unknown[] }).items;
    expect(items).toHaveLength(3);
    // Verify shape of first item
    const firstItem = items[0] as Record<string, unknown>;
    expect(firstItem).toHaveProperty("id");
    expect(firstItem).toHaveProperty("name");
    expect(firstItem).toHaveProperty("source");
    expect(firstItem).toHaveProperty("automated");
    expect(firstItem).toHaveProperty("project");
    expect(firstItem).toHaveProperty("folder");
    expect(firstItem).toHaveProperty("state");
    expect(firstItem).toHaveProperty("creator");
    expect(firstItem).toHaveProperty("tags");
    expect(firstItem).toHaveProperty("createdAt");
  });

  it("filter: folderId is included in where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, folderId: 12 },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.folderId).toBe(12);
  });

  it("filter: name uses case-insensitive contains", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, name: "login" },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.name).toEqual({ contains: "login", mode: "insensitive" });
  });

  it("filter: tagIds uses caseTags.some.tag.id.in", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, tagIds: [4, 5] },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    // RepositoryCases tags live on the RepositoryCaseTag join — filter
    // through caseTags.tag.
    expect(where.caseTags).toEqual({ some: { tag: { id: { in: [4, 5] } } } });
  });

  it("filter: stateId is included in where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, stateId: 3 },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.stateId).toBe(3);
  });

  it("filter: customField uses caseFieldValues.some with field.displayName", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, customField: { name: "Priority" } },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.caseFieldValues).toEqual({
      some: { field: { displayName: "Priority" } },
    });
  });

  it("filter: customField {name,value} resolves a Dropdown value to an option-id equals filter", async () => {
    const priorityDropdown = {
      id: 50,
      displayName: "Priority",
      type: { type: "Dropdown" },
      fieldOptions: [
        { fieldOption: { id: 99, name: "High" } },
        { fieldOption: { id: 98, name: "Low" } },
      ],
    };
    // First call: resolveCustomFields -> caseFields.findMany. Second: the list.
    mockZenstack
      .mockResolvedValueOnce([priorityDropdown])
      .mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        customField: { name: "Priority", value: "High" },
      },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.caseFieldValues).toEqual({
      some: { fieldId: 50, value: { equals: 99 } },
    });
  });

  it("filter: customField {name,value:[...]} resolves a Multi-Select to an array_contains filter", async () => {
    const components = {
      id: 60,
      displayName: "Components",
      type: { type: "Multi-Select" },
      fieldOptions: [
        { fieldOption: { id: 11, name: "Auth" } },
        { fieldOption: { id: 12, name: "Billing" } },
      ],
    };
    mockZenstack.mockResolvedValueOnce([components]).mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        customField: { name: "Components", value: ["Auth"] },
      },
    });
    const where = getLastCallBody()?.where as Record<string, unknown>;
    expect(where.caseFieldValues).toEqual({
      some: { fieldId: 60, value: { array_contains: [11] } },
    });
  });

  it("filter: customField {name,value} with an unknown field returns an error, not unfiltered results", async () => {
    // resolveCustomFields -> caseFields.findMany finds no match -> throws 422.
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        customField: { name: "DoesNotExist", value: "x" },
      },
    });
    expect(result.isError).toBeTruthy();
    // The list query must never run with a dropped/ignored filter.
    expect(mockZenstack).toHaveBeenCalledTimes(1);
  });

  it("#333: customField rejects unknown keys (strict schema) instead of silently dropping them", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        customField: { name: "Priority", bogus: "High" },
      },
    });
    expect(result.isError).toBeTruthy();
    // Strict-object validation fails before the handler runs — no query fired.
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("pagination: default limit=25, take=26, no cursor in body", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(26);
    expect(body).not.toHaveProperty("cursor");
  });

  it("pagination: with cursor — take=limit+1, cursor={id}, skip=1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, cursor: 100, limit: 10 },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(11);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
  });

  it("pagination: hasNextPage=true when result length > limit", async () => {
    // Return 26 rows for limit=25
    const rows = Array.from({ length: 26 }, (_, i) => makeRawRow({}, i + 1));
    mockZenstack.mockResolvedValueOnce(rows);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    expect((structured.items as unknown[]).length).toBe(25);
    expect(structured.hasNextPage).toBe(true);
    expect(structured.nextCursor).toBe(25); // id of last item in trimmed slice
  });

  it("pagination: hasNextPage=false when result length <= limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRawRow({}, i + 1));
    mockZenstack.mockResolvedValueOnce(rows);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    expect(structured.hasNextPage).toBe(false);
    expect(structured.nextCursor).toBeNull();
  });

  it("isDeleted: false always present in where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.isDeleted).toBe(false);
  });

  it("error path: zenstack throws TestPlanItHttpError 422 — returns isError: true", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied by policy", {
        statusCode: 422,
        code: "POLICY_DENIAL",
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    expect(result.isError).toBe(true);
    const textContent = (result.content as Array<{ type: string; text: string }>)[0];
    expect(textContent.text).toContain("422");
  });

  it("D7-03: issueId filter — happy path; where.caseIssues = { some: { issue: { id, isDeleted: false } } }", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawRow({}, 1)]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, issueId: 42 },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.projectId).toBe(7);
    expect(where.isDeleted).toBe(false);
    // RepositoryCases issue links live on the RepositoryCaseIssue join —
    // filter through caseIssues.issue.
    expect(where.caseIssues).toEqual({
      some: { issue: { id: 42, isDeleted: false } },
    });
  });

  it("D7-03: issueId filter coexists with folderId / tagIds / name / stateId / customField", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        issueId: 42,
        folderId: 1,
        tagIds: [3],
        name: "login",
        stateId: 4,
        customField: { name: "Priority" },
      },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.projectId).toBe(7);
    expect(where.folderId).toBe(1);
    expect(where.caseTags).toEqual({ some: { tag: { id: { in: [3] } } } });
    expect(where.name).toEqual({ contains: "login", mode: "insensitive" });
    expect(where.stateId).toBe(4);
    expect(where.caseFieldValues).toEqual({
      some: { field: { displayName: "Priority" } },
    });
    expect(where.caseIssues).toEqual({
      some: { issue: { id: 42, isDeleted: false } },
    });
  });

  it("D7-03: issueId rejects 0 / negative / non-integer values via zod", async () => {
    const { client } = await setupClient();
    const zero = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, issueId: 0 },
    });
    expect(zero.isError).toBe(true);

    const negative = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, issueId: -1 },
    });
    expect(negative.isError).toBe(true);

    const fractional = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, issueId: 1.5 },
    });
    expect(fractional.isError).toBe(true);

    // Zod rejected before zenstack was called for any of the three.
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("tool registration: tool is named testplanit_cases_list with correct description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCasesList(server, deps);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_cases_list");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^List test cases/);
  });

  // ── Phase 8 (D8-02) maintenance filters + new row fields ─────────────────

  // Helper: build a Phase-8-shaped raw row with the new sub-include fields.
  function makeRawRowP8(
    overrides: Record<string, unknown> = {},
    id = 1,
  ): Record<string, unknown> {
    return {
      ...makeRawRow({}, id),
      repositoryCaseVersions: [],
      junitResults: [],
      testRuns: [],
      ...overrides,
    };
  }

  it("filter: automated=true is included in where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, automated: true },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.automated).toBe(true);
  });

  it("filter: source single value", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, source: "JUNIT" },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.source).toBe("JUNIT");
  });

  it("filter: source array uses { in: [...] }", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, source: ["JUNIT", "TESTNG"] },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.source).toEqual({ in: ["JUNIT", "TESTNG"] });
  });

  it("filter: repositoryId is included in where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, repositoryId: 42 },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.repositoryId).toBe(42);
  });

  it("filter: hasNeverExecuted emits both junitResults.none and testRuns.none.results.some", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, hasNeverExecuted: true },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.junitResults).toEqual({ none: {} });
    expect(where.testRuns).toEqual({ none: { results: { some: {} } } });
  });

  it("filter: updatedAfter routes through repositoryCaseVersions.some.createdAt.gte", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, updatedAfter: "2026-04-01T00:00:00.000Z" },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    const versions = where.repositoryCaseVersions as {
      some: { createdAt: { gte: Date; lte?: Date } };
    };
    expect(versions.some.createdAt.gte).toBeInstanceOf(Date);
    expect(versions.some.createdAt.gte.toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(versions.some.createdAt.lte).toBeUndefined();
  });

  it("filter: updatedBefore routes through repositoryCaseVersions.some.createdAt.lte", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, updatedBefore: "2026-05-01T00:00:00.000Z" },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    const versions = where.repositoryCaseVersions as {
      some: { createdAt: { gte?: Date; lte: Date } };
    };
    expect(versions.some.createdAt.lte).toBeInstanceOf(Date);
    expect(versions.some.createdAt.gte).toBeUndefined();
  });

  it("filter: updatedAfter + updatedBefore combined in repositoryCaseVersions.some.createdAt", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        updatedAfter: "2026-04-01T00:00:00.000Z",
        updatedBefore: "2026-05-01T00:00:00.000Z",
      },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    const versions = where.repositoryCaseVersions as {
      some: { createdAt: { gte: Date; lte: Date } };
    };
    expect(versions.some.createdAt.gte).toBeInstanceOf(Date);
    expect(versions.some.createdAt.lte).toBeInstanceOf(Date);
  });

  it("CASE_ROW_INCLUDE: sub-includes carry deterministic orderBy (Pitfall 5 / MED-02)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const body = getLastCallBody() as {
      include: {
        repositoryCaseVersions: { take: number; orderBy: unknown[] };
        junitResults: { take: number; orderBy: unknown[] };
        testRuns: {
          select: { results: { take: number; orderBy: unknown[] } };
        };
      };
    };
    expect(body.include.repositoryCaseVersions.take).toBe(1);
    expect(body.include.repositoryCaseVersions.orderBy).toEqual([
      { version: "desc" },
      { id: "desc" },
    ]);
    expect(body.include.junitResults.take).toBe(1);
    // executedAt is nullable — nulls:"last" keeps a timestampless imported
    // row from shadowing the real latest result (Postgres puts NULLs first
    // under plain desc).
    expect(body.include.junitResults.orderBy).toEqual([
      { executedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(body.include.testRuns.select.results.take).toBe(1);
    expect(body.include.testRuns.select.results.orderBy).toEqual([
      { executedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("staleSinceUpdate=false: take = limit + 1 (default behavior unchanged)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, limit: 25 },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(26);
  });

  it("staleSinceUpdate=true: take = min(POST_FILTER_SCAN_CAP=400, limit*4) + 1", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    // limit=25 → min(400, 100) + 1 = 101
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, limit: 25, staleSinceUpdate: true },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(101);
  });

  it("staleSinceUpdate=true with limit=100 caps at POST_FILTER_SCAN_CAP+1=401", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    // limit=100 → min(400, 400) + 1 = 401
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, limit: 100, staleSinceUpdate: true },
    });
    const body = getLastCallBody();
    expect(body?.take).toBe(401);
  });

  it("staleSinceUpdate post-filter retains rows where latestExec < lastUpdated", async () => {
    // Two rows: row 1 last-updated AFTER its latest exec → STALE → kept.
    //           row 2 last-updated BEFORE its latest exec → fresh → dropped.
    const stale = makeRawRowP8(
      {
        repositoryCaseVersions: [
          { createdAt: "2026-04-15T00:00:00.000Z", version: 2 },
        ],
        junitResults: [
          {
            id: 1,
            executedAt: "2026-04-01T00:00:00.000Z",
            status: { id: 5, name: "Passed" },
          },
        ],
      },
      1,
    );
    const fresh = makeRawRowP8(
      {
        repositoryCaseVersions: [
          { createdAt: "2026-04-01T00:00:00.000Z", version: 2 },
        ],
        junitResults: [
          {
            id: 2,
            executedAt: "2026-04-15T00:00:00.000Z",
            status: { id: 5, name: "Passed" },
          },
        ],
      },
      2,
    );
    mockZenstack.mockResolvedValueOnce([stale, fresh]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, staleSinceUpdate: true },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    const items = structured.items as Array<{ id: number }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(1);
  });

  it("staleSinceUpdate post-filter retains rows with no executions (never-executed counts as stale)", async () => {
    const neverExecuted = makeRawRowP8(
      {
        repositoryCaseVersions: [
          { createdAt: "2026-04-15T00:00:00.000Z", version: 2 },
        ],
        junitResults: [],
        testRuns: [],
      },
      1,
    );
    mockZenstack.mockResolvedValueOnce([neverExecuted]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, staleSinceUpdate: true },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    const items = structured.items as Array<{ id: number }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(1);
  });

  it("staleSinceUpdate truncated:true when scan cap (POST_FILTER_SCAN_CAP=400) hit", async () => {
    // 401 rows — 400 stale, 1 fresh; surfaces truncated.
    const rows = Array.from({ length: 401 }, (_, i) =>
      makeRawRowP8(
        {
          repositoryCaseVersions: [
            { createdAt: "2026-04-15T00:00:00.000Z", version: 2 },
          ],
          junitResults: [],
          testRuns: [],
        },
        i + 1,
      ),
    );
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, limit: 100, staleSinceUpdate: true },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    expect(structured.truncated).toBe(true);
  });

  it("staleSinceUpdate=false does NOT surface truncated key", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    expect(structured.truncated).toBeUndefined();
  });

  it("Phase-8 row mapper: items carry lastUpdatedAt + latestResult", async () => {
    const row = makeRawRowP8(
      {
        repositoryCaseVersions: [
          { createdAt: "2026-04-10T00:00:00.000Z", version: 3 },
        ],
        junitResults: [
          {
            id: 99,
            executedAt: "2026-04-01T00:00:00.000Z",
            status: { id: 5, name: "Passed" },
          },
        ],
      },
      1,
    );
    mockZenstack.mockResolvedValueOnce([row]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });
    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;
    expect(items[0].lastUpdatedAt).toBe("2026-04-10T00:00:00.000Z");
    expect(items[0].latestResult).toEqual({
      id: 99,
      status: { id: 5, name: "Passed" },
      executedAt: "2026-04-01T00:00:00.000Z",
      source: "JUnit",
    });
  });

  // MED-03 invariant: cases/list.ts uses Prisma.RepositoryCasesWhereInput;
  // reintroducing Record<string, unknown> would TS2353 the new
  // automated/source filters at compile time. Verified by `pnpm typecheck`
  // against the source file (no runtime test possible without a fixture
  // that exercises the type system at the call site).
  it("MED-03 typed-where guard: automated rejects non-boolean via zod", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      // @ts-expect-error — automated must be boolean per zod schema
      arguments: { projectId: 7, automated: "not-a-boolean" },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("creatorIds: ['u1','u2'] adds where.creatorId = { in: ['u1','u2'] }", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, creatorIds: ["u1", "u2"] },
    });
    const body = getLastCallBody();
    const where = (body as { where: Record<string, unknown> }).where;
    expect(where.creatorId).toEqual({ in: ["u1", "u2"] });
  });

  it("creatorIds: [] omits where.creatorId entirely (empty-array guard)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, creatorIds: [] },
    });
    const body = getLastCallBody();
    const where = (body as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty("creatorId");
  });

  it("from alone produces where.createdAt = { gte: Date } with no lte key", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, from: "2026-04-01T00:00:00Z" },
    });
    const body = getLastCallBody();
    const where = (body as { where: { createdAt: { gte?: Date; lte?: Date } } }).where;
    expect(where.createdAt.gte).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(where.createdAt).not.toHaveProperty("lte");
  });

  it("to alone produces where.createdAt = { lte: Date } with no gte key", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, to: "2026-05-01T00:00:00Z" },
    });
    const body = getLastCallBody();
    const where = (body as { where: { createdAt: { gte?: Date; lte?: Date } } }).where;
    expect(where.createdAt.lte).toEqual(new Date("2026-05-01T00:00:00Z"));
    expect(where.createdAt).not.toHaveProperty("gte");
  });

  it("from + to + creatorIds + automated coexist additively in the same where clause", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        creatorIds: ["u1"],
        from: "2026-04-01T00:00:00Z",
        to: "2026-05-01T00:00:00Z",
        automated: true,
      },
    });
    const body = getLastCallBody();
    const where = (body as { where: Record<string, unknown> }).where;
    expect(where.creatorId).toEqual({ in: ["u1"] });
    expect(where.createdAt).toEqual({
      gte: new Date("2026-04-01T00:00:00Z"),
      lte: new Date("2026-05-01T00:00:00Z"),
    });
    expect(where.automated).toBe(true);
    expect(where.projectId).toBe(7);
    expect(where.isDeleted).toBe(false);
  });

  // ── includeDescendants (§4.2) ────────────────────────────────────────────

  function flatFolder(id: number, parentId: number | null, name = `Folder ${id}`) {
    return { id, name, parentId, order: 0, _count: { cases: 0 } };
  }

  it("includeDescendants: folderId expands to the subtree id in-clause from ONE flat folder fetch", async () => {
    mockZenstack
      // fetchProjectFolders: 1713 (Content) > 1817 (Documents) > 4462 (Commenting); 9 is another root
      .mockResolvedValueOnce([
        flatFolder(1713, null, "Content"),
        flatFolder(1817, 1713, "Documents"),
        flatFolder(4462, 1817, "Commenting"),
        flatFolder(9, null, "Settings"),
      ])
      .mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: {
        projectId: 7,
        automated: true,
        folderId: 1713,
        includeDescendants: true,
      },
    });

    expect(mockZenstack.mock.calls[0]![0]).toBe("repositoryFolders");
    const body = getLastCallBody();
    const where = (body as { where: Record<string, unknown> }).where;
    const inClause = (where.folderId as { in: number[] }).in.sort((a, b) => a - b);
    expect(inClause).toEqual([1713, 1817, 4462]); // subtree only — root 9 excluded
    expect(where.automated).toBe(true);
  });

  it("includeDescendants with a folderId outside the project: explicit tool error, no case query issued", async () => {
    mockZenstack.mockResolvedValueOnce([flatFolder(1, null)]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, folderId: 999, includeDescendants: true },
    });

    expect(result.isError).toBe(true);
    expect(mockZenstack).toHaveBeenCalledTimes(1); // only the folder fetch
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("999");
  });

  it("includeDescendants: subtree over the folder cap → explicit error pointing at cases_count, never a silently truncated scope", async () => {
    const folders = [flatFolder(1, null)];
    for (let i = 2; i <= 502; i++) folders.push(flatFolder(i, 1));
    mockZenstack.mockResolvedValueOnce(folders);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, folderId: 1, includeDescendants: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("cases_count");
  });

  it("includeDescendants without folderId: no-op — no folder fetch, project-wide where", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, includeDescendants: true },
    });

    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(mockZenstack.mock.calls[0]![0]).toBe("repositoryCases");
  });

  // ── includeFolderPath (§4.3) ─────────────────────────────────────────────

  it("includeFolderPath: rows carry folder path/ancestorIds/rootId/rootName from the same flat fetch", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        flatFolder(5, null, "Content"),
        flatFolder(12, 5, "Auth"),
      ])
      .mockResolvedValueOnce([makeRawRow({}, 1)]); // fixture folder id 12

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, includeFolderPath: true },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const items = (structured as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]!.folder).toEqual({
      id: 12,
      name: "Auth",
      path: "Content / Auth",
      ancestorIds: [5],
      rootId: 5,
      rootName: "Content",
    });
  });

  it("default (no includeFolderPath): folder stays {id, name} and no folder fetch happens", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawRow({}, 1)]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });

    expect(mockZenstack).toHaveBeenCalledTimes(1);
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const items = (structured as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]!.folder).toEqual({ id: 12, name: "Auth" });
  });

  // ── automation-reality row fields (§4.6) ─────────────────────────────────

  it("rows carry hasAutomatedResults + lastAutomatedResultAt from the junitResults sub-include", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawRow(
        {
          junitResults: [
            {
              id: 900,
              executedAt: "2026-08-01T00:00:00.000Z",
              status: { id: 1, name: "Passed" },
            },
          ],
        },
        1,
      ),
      makeRawRow({}, 2),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const items = (structured as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]!.hasAutomatedResults).toBe(true);
    expect(items[0]!.lastAutomatedResultAt).toBe("2026-08-01T00:00:00.000Z");
    expect(items[1]!.hasAutomatedResults).toBe(false);
    expect(items[1]!.lastAutomatedResultAt).toBeNull();
  });
});
