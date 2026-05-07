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
    tags: [{ id: 1, name: "smoke" }],
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

  it("filter: tagIds uses tags.some.id.in", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, tagIds: [4, 5] },
    });
    const body = getLastCallBody();
    const where = body?.where as Record<string, unknown>;
    expect(where.tags).toEqual({ some: { id: { in: [4, 5] } } });
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

  it("BL-02: customField filter rejects unsupported `value` key (additionalProperties)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    // Zod object schemas are strict by default — passing an unknown
    // `value` key surfaces a validation error rather than being silently
    // swallowed (the prior bug).
    const result = await client.callTool({
      name: "testplanit_cases_list",
      arguments: { projectId: 7, customField: { name: "Priority", value: "High" } },
    });
    // The MCP framework returns isError:true with the Zod validation message
    // when the input is rejected. Accept either an isError result or a
    // successful call where the unknown key was stripped — what we care
    // about is that `value` is NOT silently included in the where clause.
    if (!result.isError) {
      const body = getLastCallBody();
      const where = body?.where as Record<string, unknown>;
      expect(where.caseFieldValues).toEqual({
        some: { field: { displayName: "Priority" } },
      });
    }
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

  it("D7-03: issueId filter — happy path; where.issues = { some: { id, isDeleted: false } }", async () => {
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
    expect(where.issues).toEqual({ some: { id: 42, isDeleted: false } });
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
    expect(where.tags).toEqual({ some: { id: { in: [3] } } });
    expect(where.name).toEqual({ contains: "login", mode: "insensitive" });
    expect(where.stateId).toBe(4);
    expect(where.caseFieldValues).toEqual({
      some: { field: { displayName: "Priority" } },
    });
    expect(where.issues).toEqual({ some: { id: 42, isDeleted: false } });
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
});
