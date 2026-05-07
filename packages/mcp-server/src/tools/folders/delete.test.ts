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
import { registerFoldersDelete } from "./delete.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFoldersDelete(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_folders_delete", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_delete", () => {
  it("happy path: empty folder soft-deletes via update with isDeleted:true; returns {id, isDeleted:true}", async () => {
    // BL-01: pre-check returns empty arrays (no active cases, no children).
    zenstackMock.mockResolvedValueOnce([]); // active cases
    zenstackMock.mockResolvedValueOnce([]); // active children
    zenstackMock.mockResolvedValueOnce({ id: 42, isDeleted: true });

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 42, isDeleted: true });

    expect(zenstackMock).toHaveBeenCalledWith(
      "repositoryFolders",
      "update",
      expect.objectContaining({
        where: { id: 42 },
        data: { isDeleted: true },
      }),
      env,
    );
  });

  it("BL-01 pre-check: queries repositoryCases findMany filtered by folderId and isDeleted:false", async () => {
    zenstackMock.mockResolvedValueOnce([]); // active cases
    zenstackMock.mockResolvedValueOnce([]); // active children
    zenstackMock.mockResolvedValueOnce({ id: 42, isDeleted: true });

    await callTool({ folderId: 42 });

    expect(zenstackMock).toHaveBeenCalledWith(
      "repositoryCases",
      "findMany",
      expect.objectContaining({
        where: { folderId: 42, isDeleted: false },
        take: 1,
      }),
      env,
    );
    expect(zenstackMock).toHaveBeenCalledWith(
      "repositoryFolders",
      "findMany",
      expect.objectContaining({
        where: { parentId: 42, isDeleted: false },
        take: 1,
      }),
      env,
    );
  });

  it("NEVER calls 'delete' or 'deleteMany' (T-06-06 invariant)", async () => {
    zenstackMock.mockResolvedValueOnce([]); // active cases
    zenstackMock.mockResolvedValueOnce([]); // active children
    zenstackMock.mockResolvedValueOnce({ id: 42, isDeleted: true });

    await callTool({ folderId: 42 });

    for (const call of zenstackMock.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryFolders",
      "delete",
      expect.anything(),
      expect.anything(),
    );
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryFolders",
      "deleteMany",
      expect.anything(),
      expect.anything(),
    );
  });

  it("BL-01: non-empty folder (active cases) rejected with 422 'not empty'; no soft-delete PATCH issued", async () => {
    // Pre-check finds an active case in the folder.
    zenstackMock.mockResolvedValueOnce([{ id: 7 }]); // active cases (non-empty)
    zenstackMock.mockResolvedValueOnce([]); // active children

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.toLowerCase()).toContain("not empty");
    expect(text).toContain("active cases");
    // No soft-delete PATCH issued.
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryFolders",
      "update",
      expect.anything(),
      expect.anything(),
    );
    // T-06-05: no token in error
    expect(text).not.toMatch(/tpi_/);
  });

  it("BL-01: non-empty folder (active sub-folders) rejected with 422 'not empty'; no soft-delete PATCH issued", async () => {
    zenstackMock.mockResolvedValueOnce([]); // active cases
    zenstackMock.mockResolvedValueOnce([{ id: 13 }]); // active children (non-empty)

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.toLowerCase()).toContain("not empty");
    expect(text).toContain("active sub-folders");
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryFolders",
      "update",
      expect.anything(),
      expect.anything(),
    );
  });

  it("WR-03: tool-result error text never leaks the bearer token (T-06-05 defense in depth)", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        `upstream regression message containing ${env.apiToken}`,
        { statusCode: 500 },
      ),
    );
    const result = await callTool({ folderId: 42 });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    // Literal token must not appear; the redactTokens() placeholder may.
    expect(text).not.toContain(env.apiToken);
    expect(text).not.toContain("tpi_testtoken");
  });

  it("READ_ONLY_TOKEN regression: error message contains 'mode:read'", async () => {
    // Pre-check fails first with the 403 from the read.
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("tool registration: description starts with 'Soft-delete a folder'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerFoldersDelete(server, { env })).not.toThrow();
  });
});
