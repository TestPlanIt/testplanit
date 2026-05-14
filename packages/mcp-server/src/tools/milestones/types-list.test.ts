import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerMilestoneTypesList } from "./types-list.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMilestoneTypesList(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as
    | Record<string, unknown>
    | undefined;
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

describe("registerMilestoneTypesList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path returns items shaped exactly {id,name,isDefault} with no icon / cursor / hasNextPage keys", async () => {
    mockZenstack.mockResolvedValueOnce([
      { id: 1, name: "Release", isDefault: true },
      { id: 2, name: "Sprint", isDefault: false },
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestone_types_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 1, name: "Release", isDefault: true });
    expect(items[1]).toEqual({ id: 2, name: "Sprint", isDefault: false });
    // Defensive ABSENCE assertions: these keys must not appear on output.
    expect(items[0]).not.toHaveProperty("iconName");
    expect(items[0]).not.toHaveProperty("iconUrl");
    expect(items[0]).not.toHaveProperty("icon");
    // No pagination envelope.
    expect(data).not.toHaveProperty("cursor");
    expect(data).not.toHaveProperty("nextCursor");
    expect(data).not.toHaveProperty("hasNextPage");
  });

  it("where clause is exactly { isDeleted: false, projects: { some: { projectId: <input> } } }", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestone_types_list",
      arguments: { projectId: 7 },
    });
    const where = getCallBody(0)?.where as Record<string, unknown>;
    expect(where).toEqual({
      isDeleted: false,
      projects: { some: { projectId: 7 } },
    });
  });

  it("orderBy is exactly { name: 'asc' }", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestone_types_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.orderBy).toEqual({ name: "asc" });
  });

  it("select is exactly { id, name, isDefault } with no iconId or icon relation pulled", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_milestone_types_list",
      arguments: { projectId: 7 },
    });
    const body = getCallBody(0);
    expect(body?.select).toEqual({
      id: true,
      name: true,
      isDefault: true,
    });
  });

  it("response envelope has only items[] — no pagination or counts metadata", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_milestone_types_list",
      arguments: { projectId: 7 },
    });
    const data = structured(result);
    expect(Object.keys(data)).toEqual(["items"]);
  });
});
