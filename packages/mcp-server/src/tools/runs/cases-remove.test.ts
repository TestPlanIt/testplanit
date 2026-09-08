import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerRunsCasesRemove } from "./cases-remove.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

const openRun = { id: 50, isCompleted: false, compositionLockedAt: null };

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunsCasesRemove(server, deps);
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

describe("registerRunsCasesRemove", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: cascades step results → results → iterations → junction rows", async () => {
    mockZenstack
      .mockResolvedValueOnce(openRun) // run pre-check
      .mockResolvedValueOnce({ count: 3 }) // testRunStepResults.updateMany
      .mockResolvedValueOnce({ count: 2 }) // testRunResults.updateMany
      .mockResolvedValueOnce({ count: 1 }) // testRunCaseIteration.updateMany
      .mockResolvedValueOnce({ count: 2 }) // testRunCases.updateMany
      .mockResolvedValueOnce(5); // remaining count

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_remove",
      arguments: { runId: 50, caseIds: [101, 102] },
    });
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toEqual({
      runId: 50,
      requested: 2,
      removed: 2,
      total: 5,
    });

    const caseScope = {
      testRunId: 50,
      repositoryCaseId: { in: [101, 102] },
    };
    const calls = mockZenstack.mock.calls;
    expect(calls[1][0]).toBe("testRunStepResults");
    expect(calls[1][1]).toBe("updateMany");
    expect(calls[1][2]).toEqual({
      where: { testRunResult: { testRunCase: caseScope } },
      data: { isDeleted: true },
    });
    expect(calls[2][0]).toBe("testRunResults");
    expect(calls[2][2]).toEqual({
      where: { testRunCase: caseScope },
      data: { isDeleted: true },
    });
    expect(calls[3][0]).toBe("testRunCaseIteration");
    expect(calls[3][2]).toEqual({
      where: { testRunCase: caseScope },
      data: { isDeleted: true },
    });
    expect(calls[4][0]).toBe("testRunCases");
    expect(calls[4][2]).toEqual({
      where: { ...caseScope, isDeleted: false },
      data: { isDeleted: true },
    });
    // Remaining-count call excludes soft-removed rows.
    expect(calls[5][0]).toBe("testRunCases");
    expect(calls[5][1]).toBe("count");
    expect(calls[5][2]).toEqual({
      where: { testRunId: 50, isDeleted: false },
    });
  });

  it("errors when the run does not exist", async () => {
    mockZenstack.mockResolvedValueOnce(null);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_remove",
      arguments: { runId: 999, caseIds: [1] },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/not found/);
    expect(mockZenstack.mock.calls.length).toBe(1);
  });

  it("errors on a completed run without issuing writes", async () => {
    mockZenstack.mockResolvedValueOnce({ ...openRun, isCompleted: true });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_remove",
      arguments: { runId: 50, caseIds: [1] },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/completed/);
    expect(mockZenstack.mock.calls.length).toBe(1);
  });

  it("errors on a composition-locked run without issuing writes", async () => {
    mockZenstack.mockResolvedValueOnce({
      ...openRun,
      compositionLockedAt: "2026-08-01T00:00:00.000Z",
    });

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_remove",
      arguments: { runId: 50, caseIds: [1] },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/composition-locked/);
    expect(mockZenstack.mock.calls.length).toBe(1);
  });

  it("rejects an empty caseIds array at the schema layer", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_runs_cases_remove",
      arguments: { runId: 50, caseIds: [] },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack.mock.calls.length).toBe(0);
  });
});
