import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({ zenstack: vi.fn() }));
vi.mock("../cases/shared.js", async (orig) => ({ ...(await orig<object>()), resolveTagIds: vi.fn() }));

import { zenstack } from "../../api.js";
import { registerRunsUpdate } from "./update.js";

const mockZenstack = vi.mocked(zenstack);
const env = { apiUrl: "https://tpi.example.com", apiToken: "tpi_x" };

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsUpdate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name: "testplanit_runs_update", arguments: args });
}

const updateData = () =>
  (mockZenstack.mock.calls.find((c) => c[0] === "testRuns" && c[1] === "update")?.[2] as any)
    ?.data;

describe("testplanit_runs_update completion", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
    mockZenstack.mockImplementation(async (model: string, op: string) => {
      if (model === "workflows") {
        return op === "findFirst" ? { id: 90 } : [{ id: 91, name: "Blocked" }];
      }
      if (model === "testRuns" && op === "findUnique") return { projectId: 7 };
      return {};
    });
  });

  it("moves a completed runs to the project's first Done state", async () => {
    await call({ runId: 5, isCompleted: true });

    expect(updateData()).toMatchObject({
      isCompleted: true,
      state: { connect: { id: 90 } },
    });
    const doneLookup = mockZenstack.mock.calls.find(
      (c) => c[0] === "workflows" && c[1] === "findFirst",
    )![2] as any;
    expect(doneLookup.where).toMatchObject({
      scope: "RUNS",
      workflowType: "DONE",
      projects: { some: { projectId: 7 } },
    });
    expect(doneLookup.orderBy).toEqual({ order: "asc" });
  });

  it("keeps a state named alongside completion", async () => {
    await call({ runId: 5, isCompleted: true, stateName: "Blocked" });

    expect(updateData().state).toEqual({ connect: { id: 91 } });
    expect(
      mockZenstack.mock.calls.some((c) => c[0] === "workflows" && c[1] === "findFirst"),
    ).toBe(false);
  });

  it("leaves the state alone when reopening", async () => {
    await call({ runId: 5, isCompleted: false });
    expect(updateData()).toEqual({ isCompleted: false, completedAt: null });
  });
});
