import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
  resolveTagIds: vi.fn(),
}));

// resolveTagIds lives in cases/shared — mock that separately
vi.mock("../cases/shared.js", () => ({
  resolveTagIds: vi.fn(),
}));

import { zenstack, lookup } from "../../api.js";
import { resolveTagIds } from "../cases/shared.js";
import { registerRunsCreate } from "./create.js";

const mockZenstack = vi.mocked(zenstack);
const mockLookup = vi.mocked(lookup);
const mockResolveTagIds = vi.mocked(resolveTagIds);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

const MOCK_STATE = { id: 5, name: "Not Run" };
const MOCK_CREATED_RUN = { id: 42 };
const MOCK_RUN_RAW = {
  id: 42,
  name: "Smoke Suite",
  isCompleted: false,
  completedAt: null,
  createdAt: "2026-05-07T00:00:00.000Z",
  testRunType: "REGULAR",
  project: { id: 1, name: "Alpha" },
  state: { id: 5, name: "Not Run" },
  createdBy: { id: "user-1", name: "Brad", email: "brad@example.com" },
  configuration: null,
  milestone: null,
  tags: [],
  issues: [],
  testCases: [],
};

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsCreate(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function setupDefaultMocks() {
  // 1. resolveRunState: workflows.findMany returns state
  mockZenstack.mockResolvedValueOnce([MOCK_STATE]);
  // 2. resolveTagIds: no tags
  mockResolveTagIds.mockResolvedValueOnce([]);
  // 3. testRuns.create
  mockZenstack.mockResolvedValueOnce(MOCK_CREATED_RUN);
  // 4. testRuns.findUnique (re-fetch)
  mockZenstack.mockResolvedValueOnce(MOCK_RUN_RAW);
  // 5. extractStatusNames: groupBy
  mockZenstack.mockResolvedValueOnce([]);
}

describe("registerRunsCreate", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
    mockLookup.mockReset();
    mockResolveTagIds.mockReset();
  });

  it("creates a minimal run (no caseIds, no optional fields)", async () => {
    setupDefaultMocks();
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Smoke Suite" },
    });
    expect(result.isError).toBeFalsy();
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.id).toBe(42);
    expect(text.name).toBe("Smoke Suite");
    expect(text.testRunType).toBe("REGULAR");
    expect(text.total).toBe(0);
    expect(text.testCases).toEqual([]);
  });

  it("passes correct create body — project/state connect, testRunType REGULAR", async () => {
    setupDefaultMocks();
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Smoke Suite" },
    });
    // zenstack call 0 = resolveRunState (workflows.findMany)
    // zenstack call 1 = testRuns.create
    const createCall = mockZenstack.mock.calls[1];
    expect(createCall?.[0]).toBe("testRuns");
    expect(createCall?.[1]).toBe("create");
    const body = createCall?.[2] as any;
    expect(body.data.name).toBe("Smoke Suite");
    expect(body.data.testRunType).toBe("REGULAR");
    expect(body.data.project).toEqual({ connect: { id: 1 } });
    expect(body.data.state).toEqual({ connect: { id: 5 } });
  });

  it("adds test cases via testRunCases.createMany when caseIds provided", async () => {
    // 1. resolveRunState
    mockZenstack.mockResolvedValueOnce([MOCK_STATE]);
    mockResolveTagIds.mockResolvedValueOnce([]);
    // 2. testRuns.create
    mockZenstack.mockResolvedValueOnce(MOCK_CREATED_RUN);
    // 3. testRunCases.createMany
    mockZenstack.mockResolvedValueOnce({ count: 3 });
    // 4. testRuns.findUnique
    mockZenstack.mockResolvedValueOnce({ ...MOCK_RUN_RAW, testCases: [] });
    // 5. groupBy
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Smoke Suite", caseIds: [10, 20, 30] },
    });
    expect(result.isError).toBeFalsy();

    const createManyCall = mockZenstack.mock.calls[2];
    expect(createManyCall?.[0]).toBe("testRunCases");
    expect(createManyCall?.[1]).toBe("createMany");
    const data = (createManyCall?.[2] as any).data;
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({ testRunId: 42, repositoryCaseId: 10, order: 1 });
    expect(data[2]).toEqual({ testRunId: 42, repositoryCaseId: 30, order: 3 });
  });

  it("resolves stateName via workflows.findMany with name filter", async () => {
    // 1. resolveRunState with name
    mockZenstack.mockResolvedValueOnce([{ id: 7, name: "In Progress" }]);
    mockResolveTagIds.mockResolvedValueOnce([]);
    mockZenstack.mockResolvedValueOnce(MOCK_CREATED_RUN);
    mockZenstack.mockResolvedValueOnce(MOCK_RUN_RAW);
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Smoke Suite", stateName: "In Progress" },
    });

    const stateQuery = (mockZenstack.mock.calls[0]?.[2] as any).where;
    expect(stateQuery.name).toBe("In Progress");
    expect(stateQuery.scope).toBe("RUNS");
  });

  it("links milestone and config when provided", async () => {
    mockZenstack.mockResolvedValueOnce([MOCK_STATE]);
    mockResolveTagIds.mockResolvedValueOnce([]);
    mockZenstack.mockResolvedValueOnce(MOCK_CREATED_RUN);
    mockZenstack.mockResolvedValueOnce(MOCK_RUN_RAW);
    mockZenstack.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Run", milestoneId: 9, configId: 3 },
    });

    const createCall = mockZenstack.mock.calls[1];
    const body = (createCall?.[2] as any).data;
    expect(body.milestone).toEqual({ connect: { id: 9 } });
    expect(body.configuration).toEqual({ connect: { id: 3 } });
  });

  it("skips testRunCases.createMany when caseIds is empty", async () => {
    setupDefaultMocks();
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Run", caseIds: [] },
    });
    // extractStatusNames calls testRunCases.groupBy — that's expected.
    // What must NOT exist is a testRunCases.createMany call.
    const createManyCalls = mockZenstack.mock.calls.filter(
      (c) => c[0] === "testRunCases" && c[1] === "createMany",
    );
    expect(createManyCalls).toHaveLength(0);
  });

  it("propagates HTTP error from state resolution", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403 }),
    );
    mockResolveTagIds.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Run" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/Forbidden/);
  });

  it("errors when no RUNS-scope state exists", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    mockResolveTagIds.mockResolvedValueOnce([]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_create",
      arguments: { projectId: 1, name: "Run" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/RUNS-scope workflow state/);
  });

  it("rejects caseIds exceeding the 250-item cap", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_create",
      arguments: {
        projectId: 1,
        name: "Run",
        caseIds: Array.from({ length: 251 }, (_, i) => i + 1),
      },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });
});
