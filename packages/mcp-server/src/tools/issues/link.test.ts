import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerIssuesLink, registerIssuesUnlink } from "./link.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

async function setupLinkClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesLink(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

async function setupUnlinkClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerIssuesUnlink(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function getCallArgs(index = 0) {
  const call = mockZenstack.mock.calls[index];
  return {
    model: call?.[0] as string,
    op: call?.[1] as string,
    body: call?.[2] as Record<string, unknown>,
  };
}

describe("registerIssuesLink", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // 1. Single testCase link → correct connect shape
  it("links a single testCase", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 7978 });
    const { client } = await setupLinkClient();
    const result = await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 7978, entityType: "testCase", entityIds: [101] },
    });
    expect(result.isError).toBeFalsy();
    const { model, op, body } = getCallArgs();
    expect(model).toBe("issue");
    expect(op).toBe("update");
    expect(body.where).toEqual({ id: 7978 });
    expect((body.data as any).repositoryCases).toEqual({
      connect: [{ id: 101 }],
    });
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.linked).toBe(1);
    expect(text.entityIds).toEqual([101]);
  });

  // 2. Batch link — 9 testCase IDs (matches conversation use case)
  it("batch-links 9 testCases in one call", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 7978 });
    const { client } = await setupLinkClient();
    const ids = [201, 202, 203, 204, 205, 206, 207, 208, 209];
    const result = await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 7978, entityType: "testCase", entityIds: ids },
    });
    expect(result.isError).toBeFalsy();
    const { body } = getCallArgs();
    expect((body.data as any).repositoryCases.connect).toHaveLength(9);
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.linked).toBe(9);
  });

  // 3. session entityType → sessions relation
  it("maps session to sessions relation", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 1 });
    const { client } = await setupLinkClient();
    await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 1, entityType: "session", entityIds: [50] },
    });
    const { body } = getCallArgs();
    expect(Object.keys((body.data as any))[0]).toBe("sessions");
  });

  // 4. testRun entityType → testRuns relation
  it("maps testRun to testRuns relation", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 1 });
    const { client } = await setupLinkClient();
    await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 1, entityType: "testRun", entityIds: [99] },
    });
    const { body } = getCallArgs();
    expect(Object.keys((body.data as any))[0]).toBe("testRuns");
  });

  // 5. HTTP error → isError with message
  it("propagates HTTP errors", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("Not found", { statusCode: 404 }),
    );
    const { client } = await setupLinkClient();
    const result = await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 9999, entityType: "testCase", entityIds: [1] },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/Not found/);
  });

  // 6. Empty entityIds → schema validation error (isError, no zenstack call)
  it("rejects empty entityIds array", async () => {
    const { client } = await setupLinkClient();
    const result = await client.callTool({
      name: "testplanit_issues_link",
      arguments: { issueId: 1, entityType: "testCase", entityIds: [] },
    });
    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });
});

describe("registerIssuesUnlink", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  // 7. Single unlink → correct disconnect shape
  it("unlinks a single testCase", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 7978 });
    const { client } = await setupUnlinkClient();
    const result = await client.callTool({
      name: "testplanit_issues_unlink",
      arguments: { issueId: 7978, entityType: "testCase", entityIds: [101] },
    });
    expect(result.isError).toBeFalsy();
    const { model, op, body } = getCallArgs();
    expect(model).toBe("issue");
    expect(op).toBe("update");
    expect((body.data as any).repositoryCases).toEqual({
      disconnect: [{ id: 101 }],
    });
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.unlinked).toBe(1);
  });

  // 8. Batch unlink
  it("batch-unlinks multiple entities", async () => {
    mockZenstack.mockResolvedValueOnce({ id: 1 });
    const { client } = await setupUnlinkClient();
    const result = await client.callTool({
      name: "testplanit_issues_unlink",
      arguments: {
        issueId: 1,
        entityType: "testCase",
        entityIds: [10, 11, 12],
      },
    });
    expect(result.isError).toBeFalsy();
    const { body } = getCallArgs();
    expect((body.data as any).repositoryCases.disconnect).toHaveLength(3);
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.unlinked).toBe(3);
  });
});
