import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerCasesCount } from "./count.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

/** Flat folder row for the fetchProjectFolders mock. */
function flat(id: number, parentId: number | null, name = `Folder ${id}`) {
  return { id, name, parentId, order: 0, _count: { cases: 0 } };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesCount(server, { env: mockEnv });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

async function callTool(args: Record<string, unknown>) {
  const { client } = await setupClient();
  return client.callTool({ name: "testplanit_cases_count", arguments: args });
}

function structuredOf(result: unknown) {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as {
    total: number;
    groups?: Array<{ key: Record<string, unknown>; count: number }>;
  };
}

beforeEach(() => {
  mockZenstack.mockReset();
});

describe("registerCasesCount", () => {
  it("plain total: ONE count RPC, same base where as cases_list, no groups key", async () => {
    mockZenstack.mockResolvedValueOnce(137);

    const result = await callTool({ projectId: 7, automated: true });

    expect(result.isError).toBeFalsy();
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    const [model, op, body] = mockZenstack.mock.calls[0]!;
    expect(model).toBe("repositoryCases");
    expect(op).toBe("count");
    expect(body).toEqual({
      where: { projectId: 7, isDeleted: false, automated: true },
    });
    const structured = structuredOf(result);
    expect(structured.total).toBe(137);
    expect(structured.groups).toBeUndefined();
  });

  it("acceptance §4.1: automated cases per top-level area — groupBy folderRoot resolves in ONE tool call (2 RPCs)", async () => {
    mockZenstack
      // fetchProjectFolders: Content(1) > Documents(2) > Commenting(3); Settings(4)
      .mockResolvedValueOnce([
        flat(1, null, "Content"),
        flat(2, 1, "Documents"),
        flat(3, 2, "Commenting"),
        flat(4, null, "Settings"),
      ])
      // groupCountsByFolder
      .mockResolvedValueOnce([
        { folderId: 3, _count: { id: 17 } },
        { folderId: 2, _count: { id: 4 } },
        { folderId: 4, _count: { id: 2 } },
      ]);

    const result = await callTool({
      projectId: 7,
      automated: true,
      groupBy: "folderRoot",
    });

    expect(result.isError).toBeFalsy();
    expect(mockZenstack).toHaveBeenCalledTimes(2);
    const [model, op, body] = mockZenstack.mock.calls[1]!;
    expect(model).toBe("repositoryCases");
    expect(op).toBe("groupBy");
    expect(body).toEqual({
      by: ["folderId"],
      where: { projectId: 7, isDeleted: false, automated: true },
      _count: { id: true },
    });
    const { total, groups } = structuredOf(result);
    expect(total).toBe(23);
    // Sorted count desc: Content (17+4=21) then Settings (2).
    expect(groups).toEqual([
      { key: { id: 1, name: "Content" }, count: 21 },
      { key: { id: 4, name: "Settings" }, count: 2 },
    ]);
  });

  it("groupBy folder: leaf keys carry path / rootId / rootName inline — zero extra folder lookups", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        flat(1, null, "Content"),
        flat(2, 1, "Documents"),
        flat(3, 2, "Commenting"),
      ])
      .mockResolvedValueOnce([
        { folderId: 3, _count: { id: 17 } },
        { folderId: 1, _count: { id: 2 } },
      ]);

    const result = await callTool({ projectId: 7, groupBy: "folder" });

    const { total, groups } = structuredOf(result);
    expect(total).toBe(19);
    expect(groups).toEqual([
      {
        key: {
          id: 3,
          name: "Commenting",
          path: "Content / Documents / Commenting",
          rootId: 1,
          rootName: "Content",
        },
        count: 17,
      },
      {
        key: {
          id: 1,
          name: "Content",
          path: "Content",
          rootId: 1,
          rootName: "Content",
        },
        count: 2,
      },
    ]);
  });

  it("acceptance §4.2: includeDescendants total scopes to the subtree WITHOUT an id in-clause (post-filtered groupBy)", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        flat(1, null, "Content"),
        flat(2, 1, "Documents"),
        flat(3, 2, "Commenting"),
        flat(4, null, "Settings"), // outside the subtree
      ])
      .mockResolvedValueOnce([
        { folderId: 3, _count: { id: 17 } },
        { folderId: 1, _count: { id: 2 } },
        { folderId: 4, _count: { id: 99 } },
      ]);

    const result = await callTool({
      projectId: 7,
      folderId: 1,
      includeDescendants: true,
    });

    const [, op, body] = mockZenstack.mock.calls[1]!;
    expect(op).toBe("groupBy");
    // No folderId narrowing in the where — the subtree filter happens on the
    // grouped result, so arbitrarily large subtrees never hit a URL cap.
    expect((body as { where: Record<string, unknown> }).where).toEqual({
      projectId: 7,
      isDeleted: false,
    });
    expect(structuredOf(result).total).toBe(19); // 17 + 2, folder 4 excluded
  });

  it("groupBy state + includeDescendants: two-field groupBy re-aggregated after the subtree filter; names via workflows", async () => {
    mockZenstack
      .mockResolvedValueOnce([flat(1, null, "Content"), flat(2, 1, "Documents"), flat(4, null, "Settings")])
      .mockResolvedValueOnce([
        { stateId: 10, folderId: 1, _count: { id: 3 } },
        { stateId: 10, folderId: 2, _count: { id: 2 } },
        { stateId: 11, folderId: 2, _count: { id: 4 } },
        { stateId: 10, folderId: 4, _count: { id: 50 } }, // outside subtree
      ])
      .mockResolvedValueOnce([
        { id: 10, name: "Active" },
        { id: 11, name: "Draft" },
      ]);

    const result = await callTool({
      projectId: 7,
      folderId: 1,
      includeDescendants: true,
      groupBy: "state",
    });

    const groupByBody = mockZenstack.mock.calls[1]![2] as { by: string[] };
    expect(groupByBody.by).toEqual(["stateId", "folderId"]);
    const [model, op, nameBody] = mockZenstack.mock.calls[2]!;
    expect(model).toBe("workflows");
    expect(op).toBe("findMany");
    expect(nameBody).toMatchObject({ where: { id: { in: [10, 11] } } });
    const { total, groups } = structuredOf(result);
    expect(total).toBe(9);
    expect(groups).toEqual([
      { key: { id: 10, name: "Active" }, count: 5 },
      { key: { id: 11, name: "Draft" }, count: 4 },
    ]);
  });

  it("groupBy source: enum identity keys, single RPC", async () => {
    mockZenstack.mockResolvedValueOnce([
      { source: "MANUAL", _count: { id: 30 } },
      { source: "JUNIT", _count: { id: 70 } },
    ]);

    const result = await callTool({ projectId: 7, groupBy: "source" });

    expect(mockZenstack).toHaveBeenCalledTimes(1);
    const { total, groups } = structuredOf(result);
    expect(total).toBe(100);
    expect(groups).toEqual([
      { key: { id: "JUNIT", name: "JUNIT" }, count: 70 },
      { key: { id: "MANUAL", name: "MANUAL" }, count: 30 },
    ]);
  });

  it("groupBy creator: names via user findMany; a creator outside read scope resolves to nulls, not an error", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        { creatorId: "u1", _count: { id: 5 } },
        { creatorId: "u2", _count: { id: 3 } },
      ])
      .mockResolvedValueOnce([
        { id: "u1", name: "Alice", email: "alice@example.com" },
        // u2 not readable → absent
      ]);

    const result = await callTool({ projectId: 7, groupBy: "creator" });

    const { groups } = structuredOf(result);
    expect(groups).toEqual([
      { key: { id: "u1", name: "Alice", email: "alice@example.com" }, count: 5 },
      { key: { id: "u2", name: null, email: null }, count: 3 },
    ]);
  });

  it("groupBy tag: groups the RepositoryCaseTag join through its case relation; total comes from a separate count (tag sums ≠ total)", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        { tagId: 1, _count: { caseId: 9 } },
        { tagId: 2, _count: { caseId: 4 } },
      ])
      .mockResolvedValueOnce([
        { id: 1, name: "smoke" },
        { id: 2, name: "auth" },
      ])
      .mockResolvedValueOnce(10);

    const result = await callTool({ projectId: 7, groupBy: "tag" });

    const [model, op, body] = mockZenstack.mock.calls[0]!;
    expect(model).toBe("repositoryCaseTag");
    expect(op).toBe("groupBy");
    expect(body).toEqual({
      by: ["tagId"],
      where: { case: { projectId: 7, isDeleted: false } },
      _count: { caseId: true },
    });
    expect(mockZenstack.mock.calls[2]![1]).toBe("count");
    const { total, groups } = structuredOf(result);
    expect(total).toBe(10); // NOT 13 — a case can carry several tags
    expect(groups).toEqual([
      { key: { id: 1, name: "smoke" }, count: 9 },
      { key: { id: 2, name: "auth" }, count: 4 },
    ]);
  });

  it("includeDescendants with a folderId outside the project: explicit tool error", async () => {
    mockZenstack.mockResolvedValueOnce([flat(1, null)]);

    const result = await callTool({
      projectId: 7,
      folderId: 999,
      includeDescendants: true,
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("999");
    expect(text).toContain("not found in project 7");
  });

  it("error path: zenstack rejects → mapHttpErrorToToolResult", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("DB error", { statusCode: 500 }),
    );

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBe(true);
  });
});
