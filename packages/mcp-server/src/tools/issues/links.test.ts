import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerIssuesListLinks } from "./links.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesListLinks(server, deps);
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

function getCallTarget(index: number) {
  const call = mockZenstack.mock.calls[index];
  return { model: call?.[0] as string, op: call?.[1] as string };
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as
    | Record<string, unknown>
    | undefined;
}

describe("registerIssuesListLinks", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // 1. Empty input → reject
  it("{} → isError 'Provide exactly one'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Provide exactly one");
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // 2. Both modes → reject
  it("{issueId, caseId} (both modes) → isError", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 1, caseId: 2 },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // 3. Two inbound IDs → reject
  it("{caseId, sessionId} (two inbound) → isError", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { caseId: 1, sessionId: 2 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/exactly one/i);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // 4. issueId without target → reject
  it("{issueId:1} (no target) → isError 'target is required'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/target is required/i);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // 5. inbound + target → reject
  it("{caseId:1, target:'sessions'} (target with inbound) → isError 'target is only valid in outbound'", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { caseId: 1, target: "sessions" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toMatch(/only valid in outbound/i);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  // 6. Outbound: target=cases
  it("outbound target=cases → model=repositoryCases, where with issues some + isDeleted false", async () => {
    mockZenstack.mockResolvedValueOnce([
      { id: 10, name: "Case 10", source: "MANUAL", automated: false },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "cases" },
    });
    expect(result.isError).toBeFalsy();
    const target = getCallTarget(0);
    expect(target.model).toBe("repositoryCases");
    expect(target.op).toBe("findMany");
    const body = getCallBody(0);
    const where = body?.where as {
      isDeleted?: boolean;
      issues?: { some?: { id?: number; isDeleted?: boolean } };
    };
    expect(where.isDeleted).toBe(false);
    expect(where.issues?.some?.id).toBe(42);
    expect(where.issues?.some?.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 10,
      name: "Case 10",
      source: "MANUAL",
      automated: false,
    });
  });

  // 7. Outbound: target=sessions
  it("outbound target=sessions → model=sessions, denormalized state inline", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 20,
        name: "Session 20",
        isCompleted: false,
        state: { id: 3, name: "Active" },
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "sessions" },
    });
    expect(getCallTarget(0).model).toBe("sessions");
    const where = getCallBody(0)?.where as { isDeleted?: boolean };
    expect(where.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 20,
      name: "Session 20",
      isCompleted: false,
      state: { id: 3, name: "Active" },
    });
  });

  // 8. Outbound: target=sessionResults
  it("outbound target=sessionResults → model=sessionResults, status inline", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 30,
        sessionId: 20,
        executedAt: "2026-02-01T00:00:00.000Z",
        status: { id: 5, name: "Failed" },
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "sessionResults" },
    });
    expect(getCallTarget(0).model).toBe("sessionResults");
    const where = getCallBody(0)?.where as { isDeleted?: boolean };
    expect(where.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 30,
      sessionId: 20,
      executedAt: "2026-02-01T00:00:00.000Z",
      status: { id: 5, name: "Failed" },
    });
  });

  // 9. Outbound: target=testRuns
  it("outbound target=testRuns → model=testRuns, completedAt inline", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 40,
        name: "Run 40",
        isCompleted: true,
        completedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "testRuns" },
    });
    expect(getCallTarget(0).model).toBe("testRuns");
    const where = getCallBody(0)?.where as { isDeleted?: boolean };
    expect(where.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 40,
      name: "Run 40",
      isCompleted: true,
      completedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  // 10. Outbound: target=testRunResults
  it("outbound target=testRunResults → model=testRunResults, status inline", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 50,
        testRunId: 40,
        executedAt: "2026-02-01T00:00:00.000Z",
        status: { id: 1, name: "Passed" },
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "testRunResults" },
    });
    expect(getCallTarget(0).model).toBe("testRunResults");
    const where = getCallBody(0)?.where as { isDeleted?: boolean };
    expect(where.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 50,
      testRunId: 40,
      executedAt: "2026-02-01T00:00:00.000Z",
      status: { id: 1, name: "Passed" },
    });
  });

  // 11. Outbound: target=testRunStepResults — R2 stepStatus, isDeleted PRESENT
  // (Rule 1 deviation: schema.zmodel:2443 confirms TestRunStepResults DOES
  // carry isDeleted; Phase 7 runs/shared.ts:151 already filters on it. The
  // plan's claim that the column is absent is a factual error.)
  it("outbound target=testRunStepResults → model=testRunStepResults, R2 stepStatus, isDeleted=false present", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 60,
        testRunResultId: 50,
        stepStatus: { id: 5, name: "Failed" },
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "testRunStepResults" },
    });
    expect(getCallTarget(0).model).toBe("testRunStepResults");
    const body = getCallBody(0);
    const where = body?.where as {
      isDeleted?: boolean;
      issues?: { some?: { id?: number; isDeleted?: boolean } };
    };
    expect(where.isDeleted).toBe(false); // schema HAS isDeleted; we filter
    expect(where.issues?.some?.id).toBe(42);
    expect(where.issues?.some?.isDeleted).toBe(false);
    const select = body?.select as Record<string, unknown>;
    // R2: stepStatus relation, NOT status — Phase 7 invariant
    expect(select.stepStatus).toBeDefined();
    expect(select.status).toBeUndefined();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({
      id: 60,
      testRunResultId: 50,
      stepStatus: { id: 5, name: "Failed" },
    });
  });

  // 12. Inbound caseId → model=issue, where.repositoryCases.some.id
  it("inbound caseId → model=issue, where.repositoryCases.some={id, isDeleted:false}", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 70,
        projectId: 7,
        externalKey: "JIRA-70",
        title: "Bug 70",
        name: null,
        status: "open",
        externalStatus: "In Progress",
        externalUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: null,
        integration: { id: 11, name: "Jira", provider: "JIRA" },
        createdBy: { id: "u1", name: "Alice", email: "a@b" },
        _count: { repositoryCases: 4 },
      },
    ]);
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { caseId: 99 },
    });
    expect(getCallTarget(0).model).toBe("issue");
    const body = getCallBody(0);
    const where = body?.where as {
      isDeleted?: boolean;
      repositoryCases?: { some?: { id?: number; isDeleted?: boolean } };
    };
    expect(where.isDeleted).toBe(false);
    expect(where.repositoryCases?.some?.id).toBe(99);
    expect(where.repositoryCases?.some?.isDeleted).toBe(false);
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      id: 70,
      externalKey: "JIRA-70",
      externalSystem: "JIRA",
    });
  });

  // 13. Inbound runStepResultId — schema HAS isDeleted, so filter is present
  // (Rule 1 deviation: see Test 11 comment. Plan asserted absence; schema
  // and Phase 7 prove presence.)
  it("inbound runStepResultId → model=issue, where.testRunStepResults.some carries isDeleted:false (schema reality)", async () => {
    mockZenstack.mockResolvedValueOnce([
      {
        id: 71,
        projectId: 7,
        externalKey: "JIRA-71",
        title: null,
        name: "fallback-name",
        status: null,
        externalStatus: null,
        externalUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: null,
        integration: { id: 11, name: "Jira", provider: "JIRA" },
        createdBy: { id: "u1", name: "Alice", email: "a@b" },
        _count: { repositoryCases: 0 },
      },
    ]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { runStepResultId: 88 },
    });
    expect(getCallTarget(0).model).toBe("issue");
    const body = getCallBody(0);
    const where = body?.where as {
      testRunStepResults?: { some?: { id?: number; isDeleted?: boolean } };
    };
    expect(where.testRunStepResults?.some?.id).toBe(88);
    expect(where.testRunStepResults?.some?.isDeleted).toBe(false);
  });

  // 14. Cursor + limit clamp at 100
  it("cursor + limit: body.cursor={id}, body.skip=1, take=limit+1; limit>100 rejected", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "cases", cursor: 100, limit: 10 },
    });
    const body = getCallBody(0);
    expect(body?.cursor).toEqual({ id: 100 });
    expect(body?.skip).toBe(1);
    expect(body?.take).toBe(11);
    expect(body?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);

    // limit > 100 rejected by zod
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "cases", limit: 101 },
    });
    expect(result.isError).toBe(true);
  });

  // 15. Soft-delete grep guard
  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE invariant)", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "cases" },
    });
    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
  });

  // 16. Token redaction at error boundary
  it("token redaction: tpi_*** does not leak in error path", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("internal: tpi_test_secret_token leaked", {
        statusCode: 500,
      }),
    );
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_list_links",
      arguments: { issueId: 42, target: "cases" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_test_secret");
  });
});
