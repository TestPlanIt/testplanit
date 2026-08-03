import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRunsCasesUpdate } from "./cases-update.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

const head = { id: 7, testRunId: 50, isDeleted: false };

function makeRawCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    order: 3,
    isCompleted: false,
    repositoryCase: { id: 107, name: "Case 7", source: "MANUAL" },
    assignedTo: { id: "u9", name: "Bob", email: "b@b" },
    status: { id: 1, name: "Passed" },
    results: [],
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsCasesUpdate(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

function errorText(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content.map((c) => c.text).join("\n");
}

describe("registerRunsCasesUpdate", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: assigns a user and returns the list-shaped row", async () => {
    mockZenstack
      .mockResolvedValueOnce(head) // head fetch
      .mockResolvedValueOnce({ id: 7 }) // update
      .mockResolvedValueOnce(makeRawCase()); // re-fetch

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7, assignedToId: "u9" },
    });
    expect(result.isError).toBeFalsy();

    const updateCall = mockZenstack.mock.calls[1];
    expect(updateCall[0]).toBe("testRunCases");
    expect(updateCall[1]).toBe("update");
    const body = updateCall[2] as Record<string, unknown>;
    expect(body.where).toEqual({ id: 7 });
    expect(body.data).toEqual({ assignedToId: "u9" });

    const row = structured(result);
    expect(row.id).toBe(7);
    expect(row).toHaveProperty("order");
    expect(row).toHaveProperty("repositoryCase");
    expect(row).toHaveProperty("assignedTo");
    expect(row).toHaveProperty("latestResult");
  });

  it("assignedToId: null unassigns (null is passed through, not dropped)", async () => {
    mockZenstack
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce(makeRawCase({ assignedTo: null }));

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7, assignedToId: null },
    });
    expect(result.isError).toBeFalsy();
    const body = mockZenstack.mock.calls[1][2] as Record<string, unknown>;
    expect(body.data).toEqual({ assignedToId: null });
  });

  it("order: passes the new position", async () => {
    mockZenstack
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce(makeRawCase({ order: 0 }));

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7, order: 0 },
    });
    expect(result.isError).toBeFalsy();
    const body = mockZenstack.mock.calls[1][2] as Record<string, unknown>;
    expect(body.data).toEqual({ order: 0 });
  });

  it("errors when no optional field is provided (no write issued)", async () => {
    mockZenstack.mockResolvedValueOnce(head);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7 },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/No fields to update/);
    expect(mockZenstack.mock.calls.length).toBe(1); // head fetch only
  });

  it("errors when the row does not exist", async () => {
    mockZenstack.mockResolvedValueOnce(null);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 999, assignedToId: "u9" },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/not found/);
  });

  it("errors when the row was removed from the run (soft-deleted)", async () => {
    mockZenstack.mockResolvedValueOnce({ ...head, isDeleted: true });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7, assignedToId: "u9" },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/removed from the run/);
    expect(mockZenstack.mock.calls.length).toBe(1); // no write issued
  });

  it("maps a policy denial (e.g. completed run / composition lock) to a tool error", async () => {
    mockZenstack
      .mockResolvedValueOnce(head)
      .mockRejectedValueOnce(
        new TestPlanItHttpError("denied", {
          statusCode: 422,
          code: "POLICY_DENIAL",
        }),
      );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_update",
      arguments: { testRunCaseId: 7, order: 1 },
    });
    expect(result.isError).toBe(true);
  });
});
