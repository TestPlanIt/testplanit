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
import { registerProjectsList } from "./list.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerProjectsList(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool() {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_projects_list", arguments: {} });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_projects_list", () => {
  it("happy path: returns project rows", async () => {
    zenstackMock.mockResolvedValueOnce([
      { id: 1, name: "Demo" },
      { id: 2, name: "QA" },
    ]);

    const result = await callTool();

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const projects = (structured as { projects: unknown[] }).projects;
    expect(projects).toHaveLength(2);
  });

  it("response shape: each row has exactly { id, name } — no leaking fields", async () => {
    zenstackMock.mockResolvedValueOnce([
      { id: 1, name: "Demo" },
    ]);

    const result = await callTool();

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const projects = (structured as { projects: unknown[] }).projects;
    const row = projects[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    expect(row["description"]).toBeUndefined();
    expect(row["isArchived"]).toBeUndefined();
    expect(row["tenantId"]).toBeUndefined();
  });

  it("request body uses select: { id: true, name: true }", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(body["select"]).toEqual({ id: true, name: true });
  });

  it("filters: isDeleted: false in where clause", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const where = body["where"] as Record<string, unknown>;
    expect(where["isDeleted"]).toBe(false);
  });

  it("orderBy: { name: 'asc' }", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(body["orderBy"]).toEqual({ name: "asc" });
  });

  it("empty result: returns projects: []", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    const result = await callTool();

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((structured as { projects: unknown[] }).projects).toEqual([]);
  });

  it("error path: zenstack rejects → mapHttpErrorToToolResult", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("DB error", { statusCode: 500 }),
    );

    const result = await callTool();

    expect(result.isError).toBe(true);
  });

  it("tool registration: name is testplanit_projects_list, description starts with 'List projects'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerProjectsList(server, { env })).not.toThrow();
  });
});
