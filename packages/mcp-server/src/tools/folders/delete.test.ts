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
  it("happy path: soft-deletes folder via update with isDeleted:true; returns {id, isDeleted:true}", async () => {
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

  it("NEVER calls 'delete' or 'deleteMany' (T-06-06 invariant)", async () => {
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

  it("non-empty folder rejection: 422 with 'not empty' surfaces as isError, no token in message (T-06-05)", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("HTTP 422 from /api/model/repositoryFolders/update: folder not empty", { statusCode: 422 }),
    );

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.toLowerCase()).toContain("not empty");
    // T-06-05: no token prefix in error message
    expect(text).not.toMatch(/tpi_/);
  });

  it("READ_ONLY_TOKEN regression: error message contains 'mode:read'", async () => {
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
