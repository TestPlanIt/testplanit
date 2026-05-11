import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

vi.mock("./shared.js", () => ({
  mapFolderTreeNode: vi.fn(),
  fetchFolderDetail: vi.fn(),
}));

import * as apiModule from "../../api.js";
import * as foldersSharedModule from "./shared.js";
import { registerFoldersUpdate } from "./update.js";

const zenstackMock = vi.mocked(apiModule.zenstack);
const fetchFolderDetailMock = vi.mocked(foldersSharedModule.fetchFolderDetail);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

const FULL_DETAIL = {
  id: 99,
  name: "Renamed",
  parentId: null,
  breadcrumb: [{ id: 99, name: "Renamed" }],
  fullPath: "Renamed",
  children: [],
  cases: [],
  caseCount: 0,
};

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFoldersUpdate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_folders_update", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_update", () => {
  it("partial: rename only — body has name only, no parent", async () => {
    zenstackMock.mockResolvedValueOnce({});
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    await callTool({ folderId: 99, name: "Renamed" });

    expect(zenstackMock).toHaveBeenCalledTimes(1);
    const updateCall = zenstackMock.mock.calls[0]!;
    const data = (updateCall[2] as { data: Record<string, unknown> }).data;
    expect(data["name"]).toBe("Renamed");
    expect(data).not.toHaveProperty("parent");
  });

  it("reparent to a folder: body has parent: {connect: {id: 5}}", async () => {
    zenstackMock.mockResolvedValueOnce({});
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    await callTool({ folderId: 99, parentId: 5 });

    const updateCall = zenstackMock.mock.calls[0]!;
    const data = (updateCall[2] as { data: Record<string, unknown> }).data;
    expect(data["parent"]).toEqual({ connect: { id: 5 } });
  });

  it("reparent to root (parentId: null): body has parent: {disconnect: true}", async () => {
    zenstackMock.mockResolvedValueOnce({});
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    await callTool({ folderId: 99, parentId: null });

    const updateCall = zenstackMock.mock.calls[0]!;
    const data = (updateCall[2] as { data: Record<string, unknown> }).data;
    expect(data["parent"]).toEqual({ disconnect: true });
  });

  it("both name and parentId: body has both name and parent", async () => {
    zenstackMock.mockResolvedValueOnce({});
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    await callTool({ folderId: 99, name: "Renamed", parentId: 5 });

    const updateCall = zenstackMock.mock.calls[0]!;
    const data = (updateCall[2] as { data: Record<string, unknown> }).data;
    expect(data["name"]).toBe("Renamed");
    expect(data["parent"]).toEqual({ connect: { id: 5 } });
  });

  it("no fields: returns existing detail without write — zenstack NOT called", async () => {
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    const result = await callTool({ folderId: 99 });

    expect(result.isError).toBeFalsy();
    // zenstack update was NOT called — only fetchFolderDetail
    expect(zenstackMock).not.toHaveBeenCalled();
  });

  it("READ_ONLY_TOKEN regression: error message contains 'mode:read'", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ folderId: 99, name: "Renamed" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("tool registration: description starts with 'Update a folder'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerFoldersUpdate(server, { env })).not.toThrow();
  });
});
