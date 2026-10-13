import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  postHostJson: vi.fn(),
}));

vi.mock("./fetchDetail.js", () => ({
  fetchCaseDetail: vi.fn(),
}));

import * as apiModule from "../../api.js";
import * as fetchDetailModule from "./fetchDetail.js";
import { registerCasesCreate } from "./create.js";

const postHostJsonMock = vi.mocked(apiModule.postHostJson);
const fetchCaseDetailMock = vi.mocked(fetchDetailModule.fetchCaseDetail);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

const FULL_DETAIL = {
  id: 99,
  name: "Login - Valid creds",
  source: "MANUAL",
  automated: false,
  customFields: {},
};

async function callTool(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesCreate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name: "testplanit_cases_create", arguments: args });
}

const created = (caseId = 99) => ({
  success: true,
  importedCount: 1,
  failedCount: 0,
  results: [{ id: "0", name: "x", status: "success" as const, caseId }],
});

beforeEach(() => {
  vi.clearAllMocks();
  postHostJsonMock.mockResolvedValue(created());
  fetchCaseDetailMock.mockResolvedValue(FULL_DETAIL as never);
});

describe("testplanit_cases_create", () => {
  it("creates the case through the bulk-create route and returns its detail", async () => {
    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login - Valid creds",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 99 });
    const [path, body, sentEnv] = postHostJsonMock.mock.calls[0]!;
    expect(path).toBe("/api/projects/7/cases/bulk-create");
    expect(body).toEqual({
      folderId: 12,
      cases: [{ name: "Login - Valid creds" }],
    });
    expect(sentEnv).toBe(env);
    expect(fetchCaseDetailMock).toHaveBeenCalledWith(99, env);
  });

  it("passes template, state, steps, tags, custom fields and issues through unchanged", async () => {
    await callTool({
      projectId: 7,
      folderId: 12,
      name: "Full",
      templateId: 3,
      stateName: "Ready",
      integrationId: 4,
      steps: [{ text: "Open **it**", expectedResult: "Opens", order: 0 }],
      tags: [5, "smoke"],
      customFields: { Priority: "High" },
      issues: ["PROJ-1"],
    });

    expect(postHostJsonMock.mock.calls[0]![1]).toEqual({
      templateId: 3,
      folderId: 12,
      stateName: "Ready",
      integrationId: 4,
      cases: [
        {
          name: "Full",
          steps: [{ text: "Open **it**", expectedResult: "Opens", order: 0 }],
          tags: [5, "smoke"],
          customFields: { Priority: "High" },
          issues: ["PROJ-1"],
        },
      ],
    });
  });

  it("reports the host's per-case error as a tool error", async () => {
    postHostJsonMock.mockResolvedValueOnce({
      success: false,
      importedCount: 0,
      failedCount: 1,
      results: [
        {
          id: "0",
          name: "x",
          status: "error",
          error: "Custom field 'Points' expects a whole number.",
        },
      ],
    });

    const result = await callTool({ projectId: 7, folderId: 12, name: "x" });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      "Custom field 'Points' expects a whole number.",
    );
    expect(fetchCaseDetailMock).not.toHaveBeenCalled();
  });

  it("READ_ONLY_TOKEN regression: returns mode:read message", async () => {
    postHostJsonMock.mockRejectedValueOnce(
      new TestPlanItHttpError("read only", {
        statusCode: 403,
        code: "READ_ONLY_TOKEN",
      }),
    );
    const result = await callTool({ projectId: 7, folderId: 12, name: "x" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("mode:read");
  });

  it("refuses a name longer than the 255 characters the host stores", async () => {
    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "x".repeat(256),
    });
    expect(result.isError).toBe(true);
    expect(postHostJsonMock).not.toHaveBeenCalled();
  });

  it("tool error text never leaks the bearer token", async () => {
    postHostJsonMock.mockRejectedValueOnce(
      new TestPlanItHttpError("HTTP 500 from host", { statusCode: 500 }),
    );
    const result = await callTool({ projectId: 7, folderId: 12, name: "x" });
    expect(JSON.stringify(result.content)).not.toContain(env.apiToken);
  });
});
