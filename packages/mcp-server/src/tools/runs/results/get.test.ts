import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../../http.js";

vi.mock("../../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../../api.js";
import { registerRunResultsGet } from "./get.js";
import {
  JUNIT_RESULT_DETAIL_INCLUDE,
  RUN_RESULT_DETAIL_INCLUDE,
} from "../shared.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

function makeRawStepResult(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    statusId: 1,
    // R2 / Pitfall 2: relation field is `stepStatus` (NOT `status`)
    stepStatus: { id: 1, name: "Passed" },
    notes: null,
    evidence: null,
    executedAt: "2026-02-01T00:00:00.000Z",
    elapsed: null,
    step: {
      id: 700 + id,
      order: id,
      step: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Step ${id} text` }],
          },
        ],
      },
      expectedResult: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Expected ${id}` }],
          },
        ],
      },
    },
    attachments: [],
    issues: [],
    ...overrides,
  };
}

function makeRawDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    statusId: 1,
    status: { id: 1, name: "Passed" },
    executedBy: { id: "u1", name: "Alice", email: "a@b" },
    editedBy: null,
    editedAt: null,
    executedAt: "2026-02-01T00:00:00.000Z",
    attempt: 1,
    elapsed: 42,
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

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerRunResultsGet(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as Record<string, unknown> | undefined;
}

describe("registerRunResultsGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // ── Happy path with stepResults inlined ──────────────────────────────────

  it("happy path: full detail with 3 stepResults inlined", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        stepResults: [
          makeRawStepResult(1),
          makeRawStepResult(2),
          makeRawStepResult(3),
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    expect(result.isError).toBeFalsy();
    const data = structured(result);
    expect(data.id).toBe(1);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr.length).toBe(3);
    // mapStepResult output shape: id, status, stepId, stepOrder, stepText,
    // expectedResultText, notes, evidence, executedAt, elapsed, attachments, issues
    const first = sr[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("status");
    expect(first).toHaveProperty("stepId");
    expect(first).toHaveProperty("stepOrder");
    expect(first).toHaveProperty("stepText");
    expect(first).toHaveProperty("expectedResultText");
    expect(first).toHaveProperty("notes");
    expect(first).toHaveProperty("evidence");
    expect(first).toHaveProperty("attachments");
    expect(first).toHaveProperty("issues");
  });

  it("R2 / Pitfall 2: step result `status` derived from raw.stepStatus relation", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        stepResults: [
          makeRawStepResult(1, { stepStatus: { id: 5, name: "Failed" } }),
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr[0].status).toEqual({ id: 5, name: "Failed" });
  });

  it("stepText / expectedResultText extracted via extractProseMirrorText", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        stepResults: [
          makeRawStepResult(1, {
            step: {
              id: 701,
              order: 1,
              step: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Click login" }],
                  },
                ],
              },
              expectedResult: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Login form appears" }],
                  },
                ],
              },
            },
          }),
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr[0].stepText).toBe("Click login");
    expect(sr[0].expectedResultText).toBe("Login form appears");
  });

  // ── D7-08: evidence pass-through (top-level + step-level) ────────────────

  it("D7-08: top-level evidence passes through as-is (object preserved)", async () => {
    const evidence = {
      url: "https://x",
      screenshots: ["a.png", "b.png"],
      meta: { foo: "bar" },
    };
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ evidence }));
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.evidence).toEqual(evidence);
  });

  it("D7-08: step-level evidence passes through as-is (array preserved)", async () => {
    const evidence = ["row1", "row2", { nested: true }];
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        stepResults: [makeRawStepResult(1, { evidence })],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr[0].evidence).toEqual(evidence);
  });

  it("D7-08: primitive evidence passes through as-is (string preserved)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail({ evidence: "simple-blob" }));
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.evidence).toBe("simple-blob");
  });

  // ── customFields denormalization ─────────────────────────────────────────

  it("customFields denormalized via resultFieldValues -> denormalizeCustomFields (Dropdown resolved to option name)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        resultFieldValues: [
          {
            value: 7,
            field: {
              displayName: "Severity",
              type: { type: "Dropdown" },
              fieldOptions: [
                { fieldOption: { id: 7, name: "High" } },
                { fieldOption: { id: 8, name: "Low" } },
              ],
            },
          },
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.customFields).toEqual({ Severity: "High" });
  });

  // ── Notes (top-level + step-level) extracted via extractProseMirrorText ──

  it("top-level notes extracted via extractProseMirrorText", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        notes: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Some top-level note" }],
            },
          ],
        },
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.notes).toBe("Some top-level note");
  });

  it("step-level notes extracted via extractProseMirrorText", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        stepResults: [
          makeRawStepResult(1, {
            notes: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Step note" }],
                },
              ],
            },
          }),
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr[0].notes).toBe("Step note");
  });

  // ── attachments / issues shape ───────────────────────────────────────────

  it("attachments shape: {id, fileName, url} (renamed from raw `name`) — top-level + step-level", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        attachments: [
          { id: 1, name: "screen.png", url: "https://x" },
          { id: 2, name: "log.txt", url: "https://y" },
        ],
        stepResults: [
          makeRawStepResult(1, {
            attachments: [{ id: 99, name: "step.png", url: "https://z" }],
          }),
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.attachments).toEqual([
      { id: 1, fileName: "screen.png", url: "https://x" },
      { id: 2, fileName: "log.txt", url: "https://y" },
    ]);
    const sr = data.stepResults as Array<Record<string, unknown>>;
    expect(sr[0].attachments).toEqual([
      { id: 99, fileName: "step.png", url: "https://z" },
    ]);
  });

  it("issues shape: {id, externalKey, title, externalStatus, externalSystem} (externalSystem from integration.provider)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawDetail({
        issues: [
          {
            id: 555,
            externalKey: "JIRA-1",
            title: "Login broken",
            externalStatus: "Open",
            integration: { provider: "JIRA" },
          },
        ],
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const data = structured(result);
    expect(data.issues).toEqual([
      {
        id: 555,
        externalKey: "JIRA-1",
        title: "Login broken",
        externalStatus: "Open",
        externalSystem: "JIRA",
      },
    ]);
  });

  // ── Result not found ─────────────────────────────────────────────────────

  it("result not found: zenstack returns null -> isError with 'not found'", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 999 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.toLowerCase()).toContain("not found");
    expect(text).toContain("999");
  });

  // ── Include shape sent to zenstack ───────────────────────────────────────

  it("include shape on stepResults select carries `stepStatus` (NOT `status`) — R2 invariant in the wire shape", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const stepResults = include?.stepResults as Record<string, unknown>;
    const select = stepResults?.select as Record<string, unknown>;
    expect(select).toHaveProperty("stepStatus");
    // Defense-in-depth: agent-friendly `status` key MUST NOT appear at the
    // wire-include level (would TS2353 against Prisma.TestRunStepResultsSelect).
    expect(select).not.toHaveProperty("status");
  });

  it("stepResults orderBy: [{stepId:'asc'},{id:'asc'}] (R5 fallback — avoids nested step.order)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const stepResults = include?.stepResults as Record<string, unknown>;
    expect(stepResults?.orderBy).toEqual([
      { stepId: "asc" },
      { id: "asc" },
    ]);
  });

  it("stepResults `where: { isDeleted: false }` (TestRunStepResults has isDeleted)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const body = getCallBody(0);
    const include = body?.include as Record<string, unknown>;
    const stepResults = include?.stepResults as Record<string, unknown>;
    expect(stepResults?.where).toEqual({ isDeleted: false });
  });

  it("uses RUN_RESULT_DETAIL_INCLUDE constant from shared (defense-in-depth single-source-of-truth)", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawDetail());
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const body = getCallBody(0);
    expect(body?.include).toBe(RUN_RESULT_DETAIL_INCLUDE);
  });

  // ── Error path ───────────────────────────────────────────────────────────

  it("error path: zenstack throws TestPlanItHttpError -> mapHttpErrorToToolResult", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied", { statusCode: 422, code: "POLICY_DENIAL" }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/422|Request failed/);
  });

  it("token-redaction guard: tpi_ does not leak through error messages", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 1 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).not.toContain("tpi_test_secret");
  });

  // ── Tool registration ────────────────────────────────────────────────────

  it("tool registration: name + description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerRunResultsGet(server, deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    const tool = tools.tools.find(
      (t) => t.name === "testplanit_test_run_results_get",
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^Fetch a single test run result/);
  });
});

// ── JUnit source branch (automated-run results) ──────────────────────────────

describe("registerRunResultsGet — source: JUnit", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  function makeRawJunitDetail(id = 7, overrides: Record<string, unknown> = {}) {
    return {
      id,
      type: "FAILURE",
      message: "expected true to be false",
      content: "AssertionError\n  at auth.spec.ts:42",
      systemOut: "stdout text",
      systemErr: "stderr text",
      time: 1.25,
      assertions: 3,
      file: "auth.spec.ts",
      line: 42,
      executedAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:05.000Z",
      status: { id: 2, name: "Failed" },
      createdBy: { id: "u9", name: "CI Bot", email: "ci@b" },
      repositoryCase: { id: 300, name: "login spec", source: "JUNIT" },
      testSuite: {
        id: 40,
        name: "auth.spec.ts",
        testRunId: 60,
        testRun: { id: 60, name: "Nightly" },
      },
      attachments: [{ id: 1, name: "trace.zip", url: "https://x" }],
      ...overrides,
    };
  }

  it("source 'JUnit' queries jUnitTestResult with JUNIT_RESULT_DETAIL_INCLUDE", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawJunitDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 7, source: "JUnit" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(mockZenstack.mock.calls[0][0]).toBe("jUnitTestResult");
    expect(mockZenstack.mock.calls[0][1]).toBe("findUnique");
    const body = getCallBody(0);
    expect(body?.where).toEqual({ id: 7 });
    expect(body?.include).toBe(JUNIT_RESULT_DETAIL_INCLUDE);
  });

  it("junit detail shape: junitType/message/content/systemOut/systemErr + suite + attachments; executedBy from createdBy", async () => {
    mockZenstack.mockResolvedValueOnce(makeRawJunitDetail());
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 7, source: "JUnit" },
    });
    const detail = structured(result);
    expect(detail.source).toBe("JUnit");
    expect(detail.junitType).toBe("FAILURE");
    expect(detail.message).toBe("expected true to be false");
    expect(detail.content).toBe("AssertionError\n  at auth.spec.ts:42");
    expect(detail.systemOut).toBe("stdout text");
    expect(detail.systemErr).toBe("stderr text");
    expect(detail.time).toBe(1.25);
    expect(detail.assertions).toBe(3);
    expect(detail.file).toBe("auth.spec.ts");
    expect(detail.line).toBe(42);
    expect(detail.status).toEqual({ id: 2, name: "Failed" });
    expect(detail.executedBy).toEqual({ id: "u9", name: "CI Bot", email: "ci@b" });
    expect(detail.repositoryCase).toEqual({
      id: 300,
      name: "login spec",
      source: "JUNIT",
    });
    expect(detail.testRun).toEqual({ id: 60, name: "Nightly" });
    expect(detail.suite).toEqual({ id: 40, name: "auth.spec.ts" });
    expect(detail.attachments).toEqual([
      { id: 1, fileName: "trace.zip", url: "https://x" },
    ]);
    expect(detail.testRunCase).toBeNull();
  });

  it("junit not found: zenstack returns null -> isError with 'not found'", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 999, source: "JUnit" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.toLowerCase()).toContain("not found");
  });

  it("default (no source) still queries testRunResults — backward compatible", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 5 },
    });
    expect(mockZenstack.mock.calls[0][0]).toBe("testRunResults");
  });

  it("TestRun not-found message hints at retrying with source JUnit", async () => {
    mockZenstack.mockResolvedValueOnce(null);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_test_run_results_get",
      arguments: { resultId: 5 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('source: "JUnit"');
  });
});
