/**
 * `testplanit_issues_resolve` exists because `find_by_key` cannot answer for a
 * ticket nobody has opened in the web UI yet. What matters here is that it
 * hands back the same issue shape find_by_key does (so an agent can use either
 * without learning two schemas), that per-key failures are data rather than a
 * tool error, and that it never asks the host to read rows it has no ids for.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  resolveIssueKeys: vi.fn(),
}));

import { resolveIssueKeys, zenstack } from "../../api.js";
import { registerIssuesResolve } from "./resolve.js";

const mockZenstack = vi.mocked(zenstack);
const mockResolve = vi.mocked(resolveIssueKeys);

const deps = {
  env: { apiUrl: "https://testplanit.example.com", apiToken: "tpi_testtoken" },
};

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesResolve(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function issueRow(id: number, externalKey: string) {
  return {
    id,
    projectId: 1,
    externalKey,
    title: `Ticket ${externalKey}`,
    name: externalKey,
    status: "Open",
    externalStatus: "To Do",
    externalUrl: `https://jira.example.com/browse/${externalKey}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSyncedAt: null,
    integration: { id: 7, name: "Jira", provider: "JIRA" },
    createdBy: { id: "u1", name: "Ann", email: "ann@example.com" },
    _count: { caseIssues: 2 },
  };
}

beforeEach(() => {
  mockZenstack.mockReset();
  mockResolve.mockReset();
});

describe("registerIssuesResolve", () => {
  it("returns the resolved issue in find_by_key's shape", async () => {
    mockResolve.mockResolvedValue({
      success: true,
      resolvedCount: 1,
      failedCount: 0,
      createdCount: 1,
      results: [{ key: "PROJ-1", issueId: 42, created: true }],
    });
    mockZenstack.mockResolvedValue([issueRow(42, "PROJ-1")]);

    const client = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_resolve",
      arguments: { projectId: 1, keys: ["PROJ-1"] },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.resolvedCount).toBe(1);
    expect(sc.createdCount).toBe(1);
    expect(sc.resolved[0]).toMatchObject({ key: "PROJ-1", created: true });
    // externalSystem is derived from integration.provider by the shared mapper.
    expect(sc.resolved[0].issue).toMatchObject({
      id: 42,
      externalKey: "PROJ-1",
      externalSystem: "JIRA",
      summary: "Ticket PROJ-1",
      linkedCaseCount: 2,
    });
  });

  it("forwards integrationId when the caller disambiguates", async () => {
    mockResolve.mockResolvedValue({
      success: true,
      resolvedCount: 0,
      failedCount: 1,
      createdCount: 0,
      results: [{ key: "PROJ-1", error: "nope" }],
    });

    const client = await setupClient();
    await client.callTool({
      name: "testplanit_issues_resolve",
      arguments: { projectId: 1, keys: ["PROJ-1"], integrationId: 9 },
    });

    expect(mockResolve).toHaveBeenCalledWith(1, ["PROJ-1"], deps.env, 9);
  });

  it("reports a failed key as data, not as a tool error", async () => {
    mockResolve.mockResolvedValue({
      success: true,
      resolvedCount: 1,
      failedCount: 1,
      createdCount: 0,
      results: [
        { key: "PROJ-1", issueId: 42 },
        { key: "TYPO-9", error: "Issue does not exist" },
      ],
    });
    mockZenstack.mockResolvedValue([issueRow(42, "PROJ-1")]);

    const client = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_resolve",
      arguments: { projectId: 1, keys: ["PROJ-1", "TYPO-9"] },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.resolved).toHaveLength(1);
    expect(sc.failed).toEqual([
      { key: "TYPO-9", error: "Issue does not exist" },
    ]);
  });

  it("skips the row read entirely when nothing resolved", async () => {
    mockResolve.mockResolvedValue({
      success: true,
      resolvedCount: 0,
      failedCount: 1,
      createdCount: 0,
      results: [{ key: "TYPO-9", error: "Issue does not exist" }],
    });

    const client = await setupClient();
    await client.callTool({
      name: "testplanit_issues_resolve",
      arguments: { projectId: 1, keys: ["TYPO-9"] },
    });

    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("maps a read-only token to the friendly scope error", async () => {
    mockResolve.mockRejectedValue(
      new TestPlanItHttpError("HTTP 403: read-only", {
        statusCode: 403,
        code: "READ_ONLY_TOKEN",
      }),
    );

    const client = await setupClient();
    const result = await client.callTool({
      name: "testplanit_issues_resolve",
      arguments: { projectId: 1, keys: ["PROJ-1"] },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("mode:read");
  });
});
