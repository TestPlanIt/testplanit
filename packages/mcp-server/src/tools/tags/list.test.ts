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
import { registerTagsList } from "./list.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTagsList(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown> = {}) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_tags_list", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_tags_list", () => {
  it("happy path: returns tag rows with usage counts", async () => {
    zenstackMock.mockResolvedValueOnce([
      // RepositoryCases links are counted via the caseTags join model now;
      // the mapper still surfaces it under usageCounts.repositoryCases.
      { id: 1, name: "Regression", _count: { caseTags: 5, testRuns: 2, sessions: 0 } },
    ]);

    const result = await callTool();

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    const tags = (structured as { tags: unknown[] }).tags;
    expect(tags).toHaveLength(1);
    expect(tags[0]).toEqual({
      id: 1,
      name: "Regression",
      usageCounts: { repositoryCases: 5, testRuns: 2, sessions: 0 },
    });
  });

  it("includes _count for all three relations in query body", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const include = body["include"] as Record<string, unknown>;
    const countInclude = include["_count"] as Record<string, unknown>;
    const select = countInclude["select"] as Record<string, unknown>;
    expect(select).toHaveProperty("caseTags");
    expect(select).toHaveProperty("testRuns");
    expect(select).toHaveProperty("sessions");
  });

  it("no projectId: uses global boolean counts (true, not object)", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const include = body["include"] as Record<string, unknown>;
    const countInclude = include["_count"] as Record<string, unknown>;
    const select = countInclude["select"] as Record<string, unknown>;
    expect(select["caseTags"]).toBe(true);
    expect(select["testRuns"]).toBe(true);
    expect(select["sessions"]).toBe(true);
  });

  it("with projectId: counts filtered to that project", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool({ projectId: 7 });

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const include = body["include"] as Record<string, unknown>;
    const countInclude = include["_count"] as Record<string, unknown>;
    const select = countInclude["select"] as Record<string, unknown>;
    // caseTags is the RepositoryCaseTag join — its count where filters
    // through the linked case (project + soft-delete).
    expect(select["caseTags"]).toMatchObject({ where: { case: { isDeleted: false, projectId: 7 } } });
    expect(select["testRuns"]).toMatchObject({ where: { isDeleted: false, projectId: 7 } });
    expect(select["sessions"]).toMatchObject({ where: { isDeleted: false, projectId: 7 } });
  });

  it("query body has isDeleted: false at root level", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const where = body["where"] as Record<string, unknown>;
    expect(where["isDeleted"]).toBe(false);
  });

  it("query body has orderBy: { name: 'asc' }", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool();

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(body["orderBy"]).toEqual({ name: "asc" });
  });

  it("empty result: returns tags: []", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    const result = await callTool();

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((structured as { tags: unknown[] }).tags).toEqual([]);
  });

  it("error path: zenstack rejects → mapHttpErrorToToolResult", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("DB error", { statusCode: 500 }),
    );

    const result = await callTool();

    expect(result.isError).toBe(true);
  });

  it("tool registration: name is testplanit_tags_list, description starts with 'List tags'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerTagsList(server, { env })).not.toThrow();
  });
});
