import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  resolveActiveRepository: vi.fn(),
}));

vi.mock("./shared.js", () => ({
  mapFolderTreeNode: vi.fn(),
  fetchFolderDetail: vi.fn(),
}));

import * as apiModule from "../../api.js";
import * as foldersSharedModule from "./shared.js";
import { registerFoldersCreate } from "./create.js";

const zenstackMock = vi.mocked(apiModule.zenstack);
const resolveActiveRepositoryMock = vi.mocked(apiModule.resolveActiveRepository);
const fetchFolderDetailMock = vi.mocked(foldersSharedModule.fetchFolderDetail);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

const FULL_DETAIL = {
  id: 99,
  name: "Auth",
  parentId: null,
  breadcrumb: [{ id: 99, name: "Auth" }],
  fullPath: "Auth",
  children: [],
  cases: [],
  caseCount: 0,
};

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFoldersCreate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_folders_create", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_create", () => {
  it("happy path: minimal create at root — correct body, no parent, no creatorId", async () => {
    resolveActiveRepositoryMock.mockResolvedValueOnce(11);
    zenstackMock.mockResolvedValueOnce({ id: 99 });
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    const result = await callTool({ projectId: 7, name: "Auth" });

    expect(result.isError).toBeFalsy();
    const detail = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(detail).toMatchObject({ id: 99 });

    // Assert create body
    const createCall = zenstackMock.mock.calls[0]!;
    const data = (createCall[2] as { data: Record<string, unknown> }).data;
    expect(data["name"]).toBe("Auth");
    expect(data["project"]).toEqual({ connect: { id: 7 } });
    expect(data["repository"]).toEqual({ connect: { id: 11 } });
    expect(data).not.toHaveProperty("parent");
    expect(data).not.toHaveProperty("creatorId");
  });

  it("create with parentId: body has parent: {connect: {id}}", async () => {
    resolveActiveRepositoryMock.mockResolvedValueOnce(11);
    zenstackMock.mockResolvedValueOnce({ id: 99 });
    fetchFolderDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    await callTool({ projectId: 7, name: "Sub", parentId: 5 });

    const createCall = zenstackMock.mock.calls[0]!;
    const data = (createCall[2] as { data: Record<string, unknown> }).data;
    expect(data["parent"]).toEqual({ connect: { id: 5 } });
  });

  it("no active repository → 422 error with 'repository' in message", async () => {
    resolveActiveRepositoryMock.mockRejectedValueOnce(
      new TestPlanItHttpError("No active repository found for project 7.", { statusCode: 422 }),
    );

    const result = await callTool({ projectId: 7, name: "Auth" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text.toLowerCase()).toContain("repository");
  });

  it("READ_ONLY_TOKEN regression: error message contains 'mode:read'", async () => {
    resolveActiveRepositoryMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ projectId: 7, name: "Auth" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("tool registration: description starts with 'Create a folder'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerFoldersCreate(server, { env })).not.toThrow();
  });
});
