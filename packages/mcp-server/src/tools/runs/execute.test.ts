import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  postHostJson: vi.fn(),
  getHostJson: vi.fn(),
}));

import { getHostJson, postHostJson } from "../../api.js";
import { registerRunsAutomationPlan } from "./automation-plan.js";
import { registerRunsExecute } from "./execute.js";
import { registerAutomationTargetsList } from "./targets-list.js";

const mockPost = vi.mocked(postHostJson);
const mockGet = vi.mocked(getHostJson);
const deps = {
  env: { apiUrl: "https://testplanit.example.com", apiToken: "tpi_testtoken" },
};

async function setup() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsExecute(server, deps);
  registerRunsAutomationPlan(server, deps);
  registerAutomationTargetsList(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return JSON.parse(content[0].text);
}

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

describe("testplanit_runs_execute", () => {
  it("posts to the execute route and returns the execution", async () => {
    mockPost.mockResolvedValueOnce({
      executionId: 7,
      status: "PENDING",
      selectionCount: 3,
      queued: true,
    });
    const client = await setup();
    const result = await client.callTool({
      name: "testplanit_runs_execute",
      arguments: { runId: 42, targetId: 5, ref: "release", caseIds: [1, 2, 3] },
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/api/test-runs/42/execute",
      { targetId: 5, ref: "release", caseIds: [1, 2, 3] },
      deps.env,
    );
    expect(textOf(result)).toEqual({
      runId: 42,
      executionId: 7,
      status: "PENDING",
      selectionCount: 3,
      queued: true,
    });
  });

  it("maps a 409 from the host into a tool error", async () => {
    mockPost.mockRejectedValueOnce(
      new TestPlanItHttpError("HTTP 409 from /api/test-runs/42/execute: in progress", {
        statusCode: 409,
        code: "EXECUTION_IN_PROGRESS",
      }),
    );
    const client = await setup();
    const result = await client.callTool({
      name: "testplanit_runs_execute",
      arguments: { runId: 42, targetId: 5 },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });
});

describe("testplanit_runs_automation_plan", () => {
  it("reads the plan, with the execution id when given", async () => {
    mockGet.mockResolvedValueOnce({ runId: 42, cases: [], totals: { cases: 0 } });
    const client = await setup();
    const result = await client.callTool({
      name: "testplanit_runs_automation_plan",
      arguments: { runId: 42, executionId: 7 },
    });
    expect(mockGet).toHaveBeenCalledWith(
      "/api/test-runs/42/automation-plan?executionId=7",
      deps.env,
    );
    expect(textOf(result)).toMatchObject({ runId: 42 });
  });
});

describe("testplanit_automation_targets_list", () => {
  it("returns the sanitized targets", async () => {
    mockGet.mockResolvedValueOnce({
      targets: [
        { id: 5, name: "Nightly", provider: "GITHUB_ACTIONS", defaultRef: null, isEnabled: true },
      ],
    });
    const client = await setup();
    const result = await client.callTool({
      name: "testplanit_automation_targets_list",
      arguments: { projectId: 3 },
    });
    expect(mockGet).toHaveBeenCalledWith("/api/projects/3/execution-targets", deps.env);
    expect(textOf(result)).toEqual([
      { id: 5, name: "Nightly", provider: "GITHUB_ACTIONS", defaultRef: null, isEnabled: true },
    ]);
  });
});
