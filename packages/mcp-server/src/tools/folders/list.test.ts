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
import { registerFoldersList, type FolderListNode } from "./list.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

/** Flat row as returned by the repositoryFolders findMany select. */
function flat(
  id: number,
  parentId: number | null,
  caseCount = 0,
  order = 0,
) {
  return {
    id,
    name: `Folder ${id}`,
    parentId,
    order,
    _count: { cases: caseCount },
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

function treeOf(result: unknown): FolderListNode[] {
  const structured = (result as { structuredContent?: Record<string, unknown> })
    .structuredContent;
  return (structured as { tree: FolderListNode[] }).tree;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_list", () => {
  it("happy path: assembles the tree from ONE flat fetch — 2 roots each with 1 child", async () => {
    zenstackMock.mockResolvedValueOnce([
      flat(1, null, 3),
      flat(2, null, 1),
      flat(3, 1, 2),
      flat(4, 2, 1),
    ]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    expect(zenstackMock).toHaveBeenCalledTimes(1);
    const tree = treeOf(result);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[1]!.children).toHaveLength(1);
    expect(tree[0]!.children![0]!.id).toBe(3);
  });

  it("request shape: flat fetch — where has NO parentId, select._count.cases filters isDeleted:false", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool({ projectId: 7 });

    const [model, op, body] = zenstackMock.mock.calls[0]!;
    expect(model).toBe("repositoryFolders");
    expect(op).toBe("findMany");
    const { where, select } = body as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    // The WHOLE project's folders come back in one call — parentId must NOT
    // narrow to roots (the tree is assembled in memory).
    expect(where).toEqual({ projectId: 7, isDeleted: false });
    const countSelect = (select["_count"] as Record<string, unknown>)["select"] as Record<string, unknown>;
    expect((countSelect["cases"] as Record<string, unknown>)["where"]).toMatchObject({ isDeleted: false });
  });

  it("gap-3.4 fix: node at the depth cut carries its REAL caseCount and truncated:true — never wire-identical to an empty leaf", async () => {
    // depth chain: 1 → 2 → 3 → 4; folder 3 sits at the default cut (level 2)
    // with 17 direct cases and a child beyond the cut. Sibling 5 is a
    // genuinely empty leaf at the same level.
    zenstackMock.mockResolvedValueOnce([
      flat(1, null, 0),
      flat(2, 1, 0),
      flat(3, 2, 17),
      flat(5, 2, 0),
      flat(4, 3, 9),
    ]);

    const result = await callTool({ projectId: 7 });

    const tree = treeOf(result);
    const level2 = tree[0]!.children![0]!.children!;
    const cut = level2.find((n) => n.id === 3)!;
    expect(cut.caseCount).toBe(17);
    expect(cut.hasChildren).toBe(true);
    expect(cut.children).toBeNull();
    expect(cut.truncated).toBe(true);
    const emptyLeaf = level2.find((n) => n.id === 5)!;
    expect(emptyLeaf.caseCount).toBe(0);
    expect(emptyLeaf.hasChildren).toBe(false);
    expect(emptyLeaf.children).toEqual([]);
    expect(emptyLeaf.truncated).toBeUndefined();
  });

  it("depth: 'all' serializes the entire chain; depth: 0 stops at the roots", async () => {
    const rows = [flat(1, null, 1), flat(2, 1, 2), flat(3, 2, 3), flat(4, 3, 4)];

    zenstackMock.mockResolvedValueOnce(rows);
    const all = treeOf(await callTool({ projectId: 7, depth: "all" }));
    expect(
      all[0]!.children![0]!.children![0]!.children![0]!.id,
    ).toBe(4);
    expect(all[0]!.children![0]!.children![0]!.children![0]!.children).toEqual([]);

    zenstackMock.mockResolvedValueOnce(rows);
    const rootsOnly = treeOf(await callTool({ projectId: 7, depth: 0 }));
    expect(rootsOnly[0]!.children).toBeNull();
    expect(rootsOnly[0]!.truncated).toBe(true);
    expect(rootsOnly[0]!.caseCount).toBe(1);
  });

  it("includeRecursiveCounts: adds subtree + automated rollups from one extra groupBy; root recursion sums the whole subtree", async () => {
    zenstackMock
      .mockResolvedValueOnce([
        flat(1, null, 2), // root: 2 direct
        flat(2, 1, 5), //   child: 5 direct
        flat(3, 2, 17), //    grandchild: 17 direct
      ])
      // fetchAutomatedCaseCounts groupBy: automated cases per folder
      .mockResolvedValueOnce([
        { folderId: 3, _count: { id: 12 } },
        { folderId: 2, _count: { id: 1 } },
      ]);

    const result = await callTool({
      projectId: 7,
      includeRecursiveCounts: true,
      depth: "all",
    });

    expect(zenstackMock).toHaveBeenCalledTimes(2);
    const [model, op, body] = zenstackMock.mock.calls[1]!;
    expect(model).toBe("repositoryCases");
    expect(op).toBe("groupBy");
    expect(body).toMatchObject({
      by: ["folderId"],
      where: { projectId: 7, isDeleted: false, automated: true },
    });

    const root = treeOf(result)[0]!;
    expect(root.caseCount).toBe(2);
    expect(root.caseCountRecursive).toBe(24); // 2 + 5 + 17
    expect(root.automatedCaseCount).toBe(0);
    expect(root.automatedCaseCountRecursive).toBe(13); // 12 + 1
    const child = root.children![0]!;
    expect(child.caseCountRecursive).toBe(22);
    expect(child.automatedCaseCount).toBe(1);
    expect(child.automatedCaseCountRecursive).toBe(13);
    const grandchild = child.children![0]!;
    expect(grandchild.caseCountRecursive).toBe(17);
    expect(grandchild.automatedCaseCountRecursive).toBe(12);
  });

  it("default (no includeRecursiveCounts): recursive fields absent, only ONE RPC issued", async () => {
    zenstackMock.mockResolvedValueOnce([flat(1, null, 2)]);

    const result = await callTool({ projectId: 7 });

    expect(zenstackMock).toHaveBeenCalledTimes(1);
    const root = treeOf(result)[0]!;
    expect(root.caseCountRecursive).toBeUndefined();
    expect(root.automatedCaseCount).toBeUndefined();
    expect(root.automatedCaseCountRecursive).toBeUndefined();
  });

  it("empty project: returns tree: []", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    expect(treeOf(result)).toEqual([]);
  });

  it("error path: zenstack rejects → mapHttpErrorToToolResult", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("DB error", { statusCode: 500 }),
    );

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBe(true);
  });

  it("tool registration: does not throw", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerFoldersList(server, { env })).not.toThrow();
  });
});
