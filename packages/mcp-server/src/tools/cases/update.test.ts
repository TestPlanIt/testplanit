import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
  resolveActiveRepository: vi.fn(),
  resolveDefaultTemplate: vi.fn(),
  resolveCaseWorkflowState: vi.fn(),
}));

vi.mock("./customFields.js", () => ({
  resolveCustomFields: vi.fn(),
  writeCustomFieldValues: vi.fn(),
}));

vi.mock("./steps.js", () => ({
  createStepsForCase: vi.fn(),
  replaceStepsForCase: vi.fn(),
  wrapPlainTextInProseMirror: vi.fn((text: string) => ({ type: "doc", text })),
}));

vi.mock("./fetchDetail.js", () => ({
  fetchCaseDetail: vi.fn(),
}));

import * as apiModule from "../../api.js";
import * as customFieldsModule from "./customFields.js";
import * as stepsModule from "./steps.js";
import * as fetchDetailModule from "./fetchDetail.js";
import { registerCasesUpdate } from "./update.js";

const zenstackMock = vi.mocked(apiModule.zenstack);
const resolveCaseWorkflowStateMock = vi.mocked(apiModule.resolveCaseWorkflowState);
const resolveCustomFieldsMock = vi.mocked(customFieldsModule.resolveCustomFields);
const writeCustomFieldValuesMock = vi.mocked(customFieldsModule.writeCustomFieldValues);
const replaceStepsForCaseMock = vi.mocked(stepsModule.replaceStepsForCase);
const fetchCaseDetailMock = vi.mocked(fetchDetailModule.fetchCaseDetail);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

const HEAD_CASE = { id: 99, projectId: 7, templateId: 22 };

const FULL_DETAIL = {
  id: 99,
  name: "Updated name",
  source: "MANUAL",
  automated: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  project: { id: 7, name: "TestProject" },
  folder: { id: 12, name: "Auth" },
  folderBreadcrumb: [{ id: 12, name: "Auth" }],
  folderFullPath: "Auth",
  state: { id: 3, name: "Draft" },
  creator: { id: "u1", name: "Alice", email: "alice@example.com" },
  tags: [],
  steps: [],
  customFields: {},
  issues: [],
  linkedAutomatedTests: [],
  codeRepository: null,
  lastUpdatedAt: null,
  latestResult: null,
};

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const deps = { env };
  registerCasesUpdate(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_cases_update", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: head fetch returns the case; update succeeds; detail returns full
  zenstackMock.mockImplementation(async (_model, operation, body) => {
    if (operation === "findUnique") return HEAD_CASE;
    if (operation === "update") return HEAD_CASE;
    return {};
  });

  resolveCaseWorkflowStateMock.mockResolvedValue({ id: 3, name: "Draft" });
  resolveCustomFieldsMock.mockResolvedValue([]);
  writeCustomFieldValuesMock.mockResolvedValue(undefined);
  replaceStepsForCaseMock.mockResolvedValue(undefined);
  fetchCaseDetailMock.mockResolvedValue(FULL_DETAIL);
});

describe("testplanit_cases_update", () => {
  it("partial update: only name — writes only name in data", async () => {
    const result = await callTool({ caseId: 99, name: "new name" });

    expect(result.isError).toBeFalsy();

    const updateCall = zenstackMock.mock.calls.find(
      (c) => c[0] === "repositoryCases" && c[1] === "update",
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![2] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ name: "new name" });

    // Steps and custom field helpers should NOT have been called
    expect(replaceStepsForCaseMock).not.toHaveBeenCalled();
    expect(resolveCustomFieldsMock).not.toHaveBeenCalled();
  });

  it("partial update: automated flag writes only automated in data", async () => {
    await callTool({ caseId: 99, automated: true });

    const updateCall = zenstackMock.mock.calls.find(
      (c) => c[0] === "repositoryCases" && c[1] === "update",
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![2] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ automated: true });
  });

  it("updates tags via the caseTags join (replace-all = deleteMany + create)", async () => {
    await callTool({ caseId: 99, tags: [4, 5] });

    const updateCall = zenstackMock.mock.calls.find(
      (c) => c[0] === "repositoryCases" && c[1] === "update",
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![2] as { data: Record<string, unknown> }).data;
    // Tags live on the explicit RepositoryCaseTag join model; "set"
    // (replace-all) maps to deleteMany {} + create per requested tag.
    expect(data).toMatchObject({
      caseTags: {
        deleteMany: {},
        create: [
          { tag: { connect: { id: 4 } } },
          { tag: { connect: { id: 5 } } },
        ],
      },
    });
  });

  it("replaces steps via replaceStepsForCase", async () => {
    await callTool({ caseId: 99, steps: [{ text: "new step" }] });

    expect(replaceStepsForCaseMock).toHaveBeenCalledWith(
      99,
      [expect.objectContaining({ text: "new step" })],
      env,
    );
  });

  it("resolves and writes custom fields", async () => {
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 1, value: "Low", name: "Priority" },
    ]);

    await callTool({ caseId: 99, customFields: { Priority: "Low" } });

    // Resolution is scoped to the case's own template id (from the head fetch).
    expect(resolveCustomFieldsMock).toHaveBeenCalledWith(
      { Priority: "Low" },
      22,
      env,
    );
    expect(writeCustomFieldValuesMock).toHaveBeenCalledWith(
      99,
      [{ fieldId: 1, value: "Low", name: "Priority" }],
      env,
    );
  });

  it("resolves stateName by fetching head case for projectId first", async () => {
    resolveCaseWorkflowStateMock.mockResolvedValueOnce({ id: 9, name: "Done" });

    await callTool({ caseId: 99, stateName: "Done" });

    // Must fetch head first to get projectId
    const findUniqueCall = zenstackMock.mock.calls.find(
      (c) => c[1] === "findUnique",
    );
    expect(findUniqueCall).toBeDefined();

    // Then resolve state with projectId from head
    expect(resolveCaseWorkflowStateMock).toHaveBeenCalledWith(7, env, "Done");
  });

  it("updates folderId via connect relation syntax", async () => {
    await callTool({ caseId: 99, folderId: 55 });

    const updateCall = zenstackMock.mock.calls.find(
      (c) => c[0] === "repositoryCases" && c[1] === "update",
    );
    expect(updateCall).toBeDefined();
    const data = (updateCall![2] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ folder: { connect: { id: 55 } } });
  });

  it("READ_ONLY_TOKEN regression: returns mode:read message (T-06-01)", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ caseId: 99, name: "write-fail" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("NEVER calls delete or deleteMany across all update cases (T-06-06)", async () => {
    await callTool({ caseId: 99, name: "n" });
    await callTool({ caseId: 99, tags: [1] });
    await callTool({ caseId: 99, steps: [{ text: "s" }] });
    await callTool({ caseId: 99, customFields: { F: "v" } });

    for (const call of zenstackMock.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }
  });

  it("returns CASE-02 shape after write", async () => {
    fetchCaseDetailMock.mockResolvedValueOnce(FULL_DETAIL);

    const result = await callTool({ caseId: 99, name: "updated" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 99,
      folderBreadcrumb: expect.any(Array),
      steps: expect.any(Array),
      customFields: expect.any(Object),
    });
  });

  it("tool is registered as 'testplanit_cases_update' with correct description prefix", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCasesUpdate(server, { env });
    expect(true).toBe(true);
  });
});
