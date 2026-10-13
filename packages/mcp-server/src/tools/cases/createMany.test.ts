import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { EnvConfig } from "../../env.js";
import { registerCasesCreateMany } from "./createMany.js";

const env: EnvConfig = {
  apiUrl: "https://host.example.com",
  apiToken: "tpi_testtoken",
};

const fetchMock = vi.fn();

function mockFetchOnce(status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response);
}

async function callTool(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesCreateMany(server, { env });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({
    name: "testplanit_cases_create_many",
    arguments: args,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testplanit_cases_create_many", () => {
  it("happy path: POSTs to the bulk-create route and returns per-case results", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 2,
      failedCount: 0,
      results: [
        { id: "0", name: "A", status: "success", caseId: 101 },
        { id: "1", name: "B", status: "success", caseId: 102 },
      ],
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "A" }, { name: "B" }],
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      importedCount: 2,
      results: [
        { id: "0", status: "success", caseId: 101 },
        { id: "1", status: "success", caseId: 102 },
      ],
    });

    // Verify URL, method, bearer header, and body shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://host.example.com/api/projects/7/cases/bulk-create",
    );
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      "Bearer tpi_testtoken",
    );
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      folderId: 12,
      cases: [{ name: "A" }, { name: "B" }],
    });
    // projectId is carried in the URL, never the body.
    expect(body).not.toHaveProperty("projectId");
  });

  it("forwards templateId / stateName / per-case overrides in the body", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 1,
      failedCount: 0,
      results: [{ id: "0", name: "A", status: "success", caseId: 1 }],
    });

    await callTool({
      projectId: 7,
      folderId: 12,
      templateId: 55,
      stateName: "Draft",
      cases: [
        {
          name: "A",
          folderId: 99,
          stateName: "Active",
          steps: [{ text: "do x", expectedResult: "y" }],
          tags: [4, "Regression"],
          customFields: { Priority: "High" },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      templateId: 55,
      folderId: 12,
      stateName: "Draft",
      cases: [
        {
          name: "A",
          folderId: 99,
          stateName: "Active",
          steps: [{ text: "do x", expectedResult: "y" }],
          tags: [4, "Regression"],
          customFields: { Priority: "High" },
        },
      ],
    });
  });

  it("surfaces partial failure: results carry both success and error entries", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 1,
      failedCount: 1,
      results: [
        { id: "0", name: "ok", status: "success", caseId: 5 },
        {
          id: "1",
          name: "bad",
          status: "error",
          error: 'Custom field(s) not part of template "Default": Phantom.',
        },
      ],
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "ok" }, { name: "bad", customFields: { Phantom: "x" } }],
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      importedCount: number;
      failedCount: number;
      results: Array<{ status: string; error?: string }>;
    };
    expect(sc.importedCount).toBe(1);
    expect(sc.failedCount).toBe(1);
    expect(sc.results[1].status).toBe("error");
    expect(sc.results[1].error).toContain("Phantom");
  });

  it("maps a READ_ONLY_TOKEN 403 to the friendly mode:read message", async () => {
    mockFetchOnce(403, {
      error: "Token is read-only; write operations are not permitted.",
      code: "READ_ONLY_TOKEN",
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "A" }],
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!
      .text;
    expect(text).toContain("mode:read");
  });

  it("surfaces a host validation error message (e.g. 400)", async () => {
    mockFetchOnce(400, {
      error: "Template 99 is not an enabled template assigned to project 7.",
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      templateId: 99,
      cases: [{ name: "A" }],
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!
      .text;
    expect(text).toContain("Template 99");
  });

  it("never leaks the bearer token in an error message", async () => {
    mockFetchOnce(500, {
      error: `boom containing ${env.apiToken}`,
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "A" }],
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!
      .text;
    expect(text).not.toContain(env.apiToken);
  });

  // #597: the tool is a thin pipe for `issues` — the host resolves the keys,
  // so anything the tool rewrites here is a key the tracker will never match.
  it("passes per-case issues keys through to the bulk-create body untouched", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 2,
      failedCount: 0,
      results: [
        { id: "0", name: "A", status: "success", caseId: 1 },
        { id: "1", name: "B", status: "success", caseId: 2 },
      ],
    });

    await callTool({
      projectId: 7,
      folderId: 12,
      cases: [
        { name: "A", issues: ["PROJ-1"] },
        { name: "B", issues: ["PROJ-1", "proj-2", "ABC_DEF-99"] },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Verbatim: no dedup, no upper-casing, no reordering, no flattening to a
    // batch-level field — the host owns all of that.
    expect(body.cases).toEqual([
      { name: "A", issues: ["PROJ-1"] },
      { name: "B", issues: ["PROJ-1", "proj-2", "ABC_DEF-99"] },
    ]);
  });

  it("forwards batch-level integrationId, and omits it when unset", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 1,
      failedCount: 0,
      results: [{ id: "0", name: "A", status: "success", caseId: 1 }],
    });

    await callTool({
      projectId: 7,
      folderId: 12,
      integrationId: 9,
      cases: [{ name: "A", issues: ["PROJ-1"] }],
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject(
      { integrationId: 9 },
    );

    mockFetchOnce(200, {
      success: true,
      importedCount: 1,
      failedCount: 0,
      results: [{ id: "0", name: "A", status: "success", caseId: 1 }],
    });

    await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "A", issues: ["PROJ-1"] }],
    });

    // Absent rather than `integrationId: undefined` — the host treats the key
    // being present as "the caller disambiguated".
    expect(
      JSON.parse(fetchMock.mock.calls[1][1].body as string),
    ).not.toHaveProperty("integrationId");
  });

  it("surfaces a per-case issue-key resolution failure without failing the tool", async () => {
    mockFetchOnce(200, {
      success: true,
      importedCount: 1,
      failedCount: 1,
      results: [
        { id: "0", name: "good", status: "success", caseId: 5 },
        {
          id: "1",
          name: "bad",
          status: "error",
          error: 'Issue key "TYPO-9": Issue does not exist.',
        },
      ],
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [
        { name: "good", issues: ["PROJ-1"] },
        { name: "bad", issues: ["TYPO-9"] },
      ],
    });

    // One unresolvable key fails its own case only — the batch is a 200 and
    // the tool result is not an error envelope.
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      importedCount: number;
      failedCount: number;
      results: Array<{ name: string; status: string; error?: string }>;
    };
    expect(sc.importedCount).toBe(1);
    expect(sc.failedCount).toBe(1);
    expect(sc.results[0]).toMatchObject({ name: "good", status: "success" });
    expect(sc.results[1].status).toBe("error");
    expect(sc.results[1].error).toContain("TYPO-9");
  });

  it("maps a batch-wide integration failure (400) to a tool error", async () => {
    mockFetchOnce(400, {
      error:
        "Project 7 has more than one active issue-tracker integration. Pass integrationId.",
    });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      cases: [{ name: "A", issues: ["PROJ-1"] }],
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!
      .text;
    expect(text).toContain("integrationId");
  });
});
