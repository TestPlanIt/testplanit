import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({ zenstack: vi.fn() }));

import { zenstack } from "../../api.js";
import { registerMilestonesCreate } from "./create.js";

const mockZenstack = vi.mocked(zenstack);
const env = { apiUrl: "https://tpi.example.com", apiToken: "tpi_x" };

const CREATED = {
  id: 12,
  name: "Sprint 1",
  projectId: 7,
  isStarted: false,
  isCompleted: false,
  startedAt: null,
  completedAt: null,
  note: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  milestoneType: { id: 3, name: "Sprint" },
  creator: { id: "u1", name: "Agent", email: "a@example.com" },
  parent: null,
};

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMilestonesCreate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name: "testplanit_milestones_create", arguments: args });
}

const createData = () =>
  (mockZenstack.mock.calls.find((c) => c[0] === "milestones" && c[1] === "create")?.[2] as any)
    ?.data;

describe("testplanit_milestones_create", () => {
  beforeEach(() => mockZenstack.mockReset());

  it("uses the milestone type marked Default when none is given", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 3 }); // default type
    mockZenstack.mockResolvedValueOnce(CREATED);

    const result = await call({ projectId: 7, name: "Sprint 1" });

    expect(result.isError).toBeFalsy();
    expect((mockZenstack.mock.calls[0]![2] as any).where).toEqual({
      isDefault: true,
      isDeleted: false,
    });
    expect(createData().milestoneType).toEqual({ connect: { id: 3 } });
  });

  it("uses an explicit milestone type without looking up the default", async () => {
    mockZenstack.mockResolvedValueOnce(CREATED);

    await call({ projectId: 7, name: "Sprint 1", milestoneTypeId: 5 });

    expect(createData().milestoneType).toEqual({ connect: { id: 5 } });
    expect(mockZenstack).toHaveBeenCalledTimes(1);
  });

  it("leaves the creator to the host, which fills it from the token", async () => {
    mockZenstack.mockResolvedValueOnce(CREATED);
    await call({ projectId: 7, name: "Sprint 1", milestoneTypeId: 5 });
    expect(createData()).not.toHaveProperty("creator");
    expect(createData()).not.toHaveProperty("createdBy");
  });

  it("explains when no type is marked Default", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const result = await call({ projectId: 7, name: "Sprint 1" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("milestoneTypeId");
  });
});
