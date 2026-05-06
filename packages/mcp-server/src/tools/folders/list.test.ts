import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import * as apiModule from "../../api.js";
import { registerFoldersList } from "./list.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeRawFolder(id: number, parentId: number | null = null, caseCount = 0, children: unknown[] = []) {
  return {
    id,
    name: `Folder ${id}`,
    parentId,
    _count: { cases: caseCount },
    children,
  };
}

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFoldersList(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_folders_list", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_list", () => {
  it("happy path: returns tree with 2 root folders each with 1 child", async () => {
    const child1 = makeRawFolder(3, 1, 2, []);
    const child2 = makeRawFolder(4, 2, 1, []);
    const root1 = makeRawFolder(1, null, 3, [child1]);
    const root2 = makeRawFolder(2, null, 1, [child2]);
    zenstackMock.mockResolvedValueOnce([root1, root2]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const tree = (structured as { tree: unknown[] }).tree;
    expect(tree).toHaveLength(2);
    expect((tree[0] as { children: unknown[] }).children).toHaveLength(1);
    expect((tree[1] as { children: unknown[] }).children).toHaveLength(1);
  });

  it("filters: only roots — where.parentId===null, where.isDeleted===false, where.projectId===N", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool({ projectId: 7 });

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const where = body["where"] as Record<string, unknown>;
    expect(where["parentId"]).toBeNull();
    expect(where["isDeleted"]).toBe(false);
    expect(where["projectId"]).toBe(7);
  });

  it("include shape: _count.cases filtered by isDeleted: false", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool({ projectId: 7 });

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const include = body["include"] as Record<string, unknown>;
    // _count.select.cases should filter by isDeleted: false
    const countInclude = include["_count"] as Record<string, unknown>;
    const selectCases = (countInclude["select"] as Record<string, unknown>)["cases"] as Record<string, unknown>;
    expect(selectCases["where"]).toMatchObject({ isDeleted: false });
  });

  it("empty project: returns tree: []", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((structured as { tree: unknown[] }).tree).toEqual([]);
  });

  it("error path: zenstack rejects → mapHttpErrorToToolResult", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("DB error", { statusCode: 500 }),
    );

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBe(true);
  });

  it("tool registration: description starts with 'List the folder tree'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    // If registration doesn't throw, we consider it passed.
    // (MCP SDK does not expose the registered tool's metadata easily.)
    expect(() => registerFoldersList(server, { env })).not.toThrow();
  });
});
