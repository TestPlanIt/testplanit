import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock global fetch — submit-result is reached via a raw fetch.
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

vi.mock("../../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../../api.js";
import { registerRunResultsCreate } from "./create.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

const okSubmitResponse = (id: number) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ result: { id } }),
});

const errorSubmitResponse = (status: number, body: unknown) => ({
  ok: false,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

function makeRawDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 999,
    statusId: 1,
    status: { id: 1, name: "Passed" },
    executedBy: { id: "u1", name: "Alice", email: "a@b" },
    editedBy: null,
    editedAt: null,
    executedAt: "2026-02-01T00:00:00.000Z",
    attempt: 1,
    elapsed: null,
    notes: null,
    evidence: null,
    testRunCase: {
      id: 50,
      repositoryCaseId: 100,
      repositoryCase: { id: 100, name: "Case 1", source: "MANUAL" },
      testRun: { id: 7, name: "Run A" },
    },
    attachments: [],
    issues: [],
    resultFieldValues: [],
    stepResults: [],
    ...overrides,
  };
}

const RUN_CASE = {
  id: 50,
  testRunId: 7,
  testRun: { projectId: 1 },
  repositoryCase: { templateId: 12 },
};

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunResultsCreate(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

describe("registerRunResultsCreate", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
    mockFetch.mockReset();
  });

  it("creates a minimal result (no fieldValues): looks up runCase, status, count, re-fetch", async () => {
    // 1. testRunCases.findUnique
    mockZenstack.mockResolvedValueOnce(RUN_CASE);
    // 2. status.findMany
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);
    // 3. testRunResults.count
    mockZenstack.mockResolvedValueOnce(2);
    // submit-result via fetch
    mockFetch.mockResolvedValueOnce(okSubmitResponse(999));
    // 4. testRunResults.findUnique (re-fetch)
    mockZenstack.mockResolvedValueOnce(makeRawDetail());

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: { testRunCaseId: 50, statusName: "Passed" },
    });

    expect(result.isError).toBeFalsy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1].body as string);
    expect(body).toMatchObject({
      testRunId: 7,
      testRunCaseId: 50,
      statusId: 5,
      attempt: 3,
    });
    expect(body.fieldValues).toBeUndefined();
  });

  it("resolves fieldValues by displayName (case-insensitive) → fieldId; sends them in the submit payload", async () => {
    mockZenstack.mockResolvedValueOnce(RUN_CASE);
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);
    // templateResultAssignment.findMany
    mockZenstack.mockResolvedValueOnce([
      {
        resultField: {
          id: 11,
          displayName: "Defect Severity",
          systemName: "defect_severity",
        },
      },
      {
        resultField: {
          id: 12,
          displayName: "Reproducibility",
          systemName: "reproducibility",
        },
      },
    ]);
    mockZenstack.mockResolvedValueOnce(0); // count
    mockFetch.mockResolvedValueOnce(okSubmitResponse(999));
    mockZenstack.mockResolvedValueOnce(makeRawDetail());

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: {
        testRunCaseId: 50,
        statusName: "Failed",
        fieldValues: [
          { name: "defect severity", value: "High" }, // case-insensitive displayName
          { name: "reproducibility", value: 3 }, // number coerced to string
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1].body as string);
    expect(body.fieldValues).toEqual([
      { fieldId: 11, value: "High" },
      { fieldId: 12, value: "3" },
    ]);
  });

  it("resolves fieldValues by systemName when displayName doesn't match", async () => {
    mockZenstack.mockResolvedValueOnce(RUN_CASE);
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);
    mockZenstack.mockResolvedValueOnce([
      {
        resultField: {
          id: 11,
          displayName: "Defect Severity",
          systemName: "severity",
        },
      },
    ]);
    mockZenstack.mockResolvedValueOnce(0);
    mockFetch.mockResolvedValueOnce(okSubmitResponse(999));
    mockZenstack.mockResolvedValueOnce(makeRawDetail());

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: {
        testRunCaseId: 50,
        statusName: "Passed",
        fieldValues: [{ name: "severity", value: "Low" }],
      },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1].body as string);
    expect(body.fieldValues).toEqual([{ fieldId: 11, value: "Low" }]);
  });

  it("returns isError with the available field list when a fieldValues name doesn't match", async () => {
    mockZenstack.mockResolvedValueOnce(RUN_CASE);
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);
    mockZenstack.mockResolvedValueOnce([
      {
        resultField: {
          id: 11,
          displayName: "Defect Severity",
          systemName: "defect_severity",
        },
      },
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: {
        testRunCaseId: 50,
        statusName: "Passed",
        fieldValues: [{ name: "Unknown Field", value: "x" }],
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/Unknown result field name\(s\): Unknown Field/);
    expect(text).toMatch(/Defect Severity/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces REQUIRED_FIELDS_MISSING from the server unchanged (gate intact)", async () => {
    mockZenstack.mockResolvedValueOnce(RUN_CASE);
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);
    mockZenstack.mockResolvedValueOnce(0); // count (no fieldValues path, no template lookup)
    mockFetch.mockResolvedValueOnce(
      errorSubmitResponse(400, {
        error: "A required result field is missing a value",
        code: "REQUIRED_FIELDS_MISSING",
      })
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: { testRunCaseId: 50, statusName: "Passed" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/required result field is missing/);
  });

  it("rejects fieldValues when the case has no template (templateId null)", async () => {
    mockZenstack.mockResolvedValueOnce({
      ...RUN_CASE,
      repositoryCase: { templateId: null },
    });
    mockZenstack.mockResolvedValueOnce([{ id: 5 }]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: {
        testRunCaseId: 50,
        statusName: "Passed",
        fieldValues: [{ name: "Severity", value: "High" }],
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/no template/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the not-found error when the testRunCase doesn't exist", async () => {
    mockZenstack.mockResolvedValueOnce(null);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_create",
      arguments: { testRunCaseId: 999, statusName: "Passed" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/TestRunCase 999 not found/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
