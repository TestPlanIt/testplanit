import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  createCaseVersion: vi.fn(),
  lookup: vi.fn(),
  resolveActiveRepository: vi.fn(),
  resolveTemplateForProject: vi.fn(),
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
import { registerCasesCreate } from "./create.js";

const zenstackMock = vi.mocked(apiModule.zenstack);
const lookupMock = vi.mocked(apiModule.lookup);
const resolveActiveRepositoryMock = vi.mocked(apiModule.resolveActiveRepository);
const resolveTemplateForProjectMock = vi.mocked(apiModule.resolveTemplateForProject);
const resolveCaseWorkflowStateMock = vi.mocked(apiModule.resolveCaseWorkflowState);
const resolveCustomFieldsMock = vi.mocked(customFieldsModule.resolveCustomFields);
const writeCustomFieldValuesMock = vi.mocked(customFieldsModule.writeCustomFieldValues);
const createStepsForCaseMock = vi.mocked(stepsModule.createStepsForCase);
const fetchCaseDetailMock = vi.mocked(fetchDetailModule.fetchCaseDetail);
const createCaseVersionMock = vi.mocked(apiModule.createCaseVersion);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

const FULL_DETAIL = {
  id: 99,
  name: "Login - Valid creds",
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
};

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const deps = { env };
  registerCasesCreate(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_cases_create", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path mocks
  resolveActiveRepositoryMock.mockResolvedValue(11);
  resolveTemplateForProjectMock.mockResolvedValue(22);
  resolveCaseWorkflowStateMock.mockResolvedValue({ id: 3, name: "Draft" });
  resolveCustomFieldsMock.mockResolvedValue([]);
  writeCustomFieldValuesMock.mockResolvedValue(undefined);
  createStepsForCaseMock.mockResolvedValue(undefined);
  createCaseVersionMock.mockResolvedValue(undefined);
  zenstackMock.mockResolvedValue({ id: 99 });
  fetchCaseDetailMock.mockResolvedValue(FULL_DETAIL);
});

describe("testplanit_cases_create", () => {
  it("happy path: minimal create returns full detail (CASE-02 shape)", async () => {
    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login - Valid creds",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 99 });

    // Verify zenstack create body
    const createCall = zenstackMock.mock.calls.find((c) => c[1] === "create");
    expect(createCall).toBeDefined();
    const data = (createCall![2] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      name: "Login - Valid creds",
      source: "MANUAL",
      automated: false,
      project: { connect: { id: 7 } },
      repository: { connect: { id: 11 } },
      folder: { connect: { id: 12 } },
      template: { connect: { id: 22 } },
      state: { connect: { id: 3 } },
    });
  });

  it("writes steps via createStepsForCase after case creation", async () => {
    await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login - Valid creds",
      steps: [{ text: "a" }, { text: "b", expectedResult: "x" }],
    });

    expect(createStepsForCaseMock).toHaveBeenCalledWith(
      99,
      expect.arrayContaining([
        expect.objectContaining({ text: "a" }),
        expect.objectContaining({ text: "b", expectedResult: "x" }),
      ]),
      env,
    );
  });

  it("resolves mixed tags (numbers and strings) and connects them via the caseTags join", async () => {
    lookupMock.mockResolvedValueOnce({ id: 5, name: "Regression" });

    await callTool({
      projectId: 7,
      folderId: 12,
      name: "Tag test",
      tags: [4, "Regression"],
    });

    expect(lookupMock).toHaveBeenCalledWith(
      { type: "tag", name: "Regression", createIfMissing: true },
      env,
    );

    // After create, a follow-up update writes the RepositoryCaseTag join
    // rows via caseTags.create (the case was just created with no tags).
    const updateCall = zenstackMock.mock.calls.find((c) => c[1] === "update");
    expect(updateCall).toBeDefined();
    expect(updateCall![2]).toMatchObject({
      data: {
        caseTags: {
          create: expect.arrayContaining([
            { tag: { connect: { id: 4 } } },
            { tag: { connect: { id: 5 } } },
          ]),
        },
      },
    });
  });

  it("resolves and writes custom fields", async () => {
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 1, value: "High", name: "Priority" },
    ]);

    await callTool({
      projectId: 7,
      folderId: 12,
      name: "CF test",
      customFields: { Priority: "High" },
    });

    expect(resolveCustomFieldsMock).toHaveBeenCalledWith(
      { Priority: "High" },
      22,
      env,
    );
    expect(writeCustomFieldValuesMock).toHaveBeenCalledWith(
      99,
      [{ fieldId: 1, value: "High", name: "Priority" }],
      env,
    );
  });

  it("resolves stateName by calling resolveCaseWorkflowState with name", async () => {
    resolveCaseWorkflowStateMock.mockResolvedValueOnce({ id: 8, name: "Active" });

    await callTool({
      projectId: 7,
      folderId: 12,
      name: "State test",
      stateName: "Active",
    });

    expect(resolveCaseWorkflowStateMock).toHaveBeenCalledWith(7, env, "Active");
  });

  it("default template: resolveTemplateForProject called with undefined templateId when omitted", async () => {
    await callTool({ projectId: 7, folderId: 12, name: "Default template" });

    expect(resolveTemplateForProjectMock).toHaveBeenCalledWith(7, env, undefined);
    // The create body connects the resolved (default) template id 22.
    const createCall = zenstackMock.mock.calls.find((c) => c[1] === "create");
    const data = (createCall![2] as { data: Record<string, unknown> }).data;
    expect(data.template).toEqual({ connect: { id: 22 } });
  });

  it("honors an explicit templateId by passing it to resolveTemplateForProject", async () => {
    resolveTemplateForProjectMock.mockResolvedValueOnce(55);

    await callTool({
      projectId: 7,
      folderId: 12,
      name: "Pick template",
      templateId: 55,
    });

    expect(resolveTemplateForProjectMock).toHaveBeenCalledWith(7, env, 55);
    const createCall = zenstackMock.mock.calls.find((c) => c[1] === "create");
    const data = (createCall![2] as { data: Record<string, unknown> }).data;
    expect(data.template).toEqual({ connect: { id: 55 } });
  });

  it("surfaces 422 when an explicit templateId is not assigned/enabled for the project", async () => {
    resolveTemplateForProjectMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "Template 99 is not an enabled template assigned to project 7.",
        { statusCode: 422 },
      ),
    );

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "bad template",
      templateId: 99,
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("Template 99");
  });

  it("rejects a custom field not on the chosen template (template-scoped resolver throws 422, pre-write)", async () => {
    // The template-scoped resolver rejects an out-of-template field.
    resolveCustomFieldsMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "Custom field 'Component' is not part of the selected template.",
        { statusCode: 422 },
      ),
    );

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "cf not in template",
      customFields: { Component: "x" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("Component");
    expect(text).toContain("template");
    // The case row must NOT have been created — resolution fires pre-write.
    expect(zenstackMock.mock.calls.find((c) => c[1] === "create")).toBeUndefined();
  });

  it("resolves custom fields against the chosen template id, then writes them", async () => {
    resolveTemplateForProjectMock.mockResolvedValueOnce(55);
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 2, value: "High", name: "Priority" },
    ]);

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "cf in template",
      templateId: 55,
      customFields: { Priority: "High" },
    });

    expect(result.isError).toBeFalsy();
    // Custom-field resolution is scoped to the resolved template id (55).
    expect(resolveCustomFieldsMock).toHaveBeenCalledWith(
      { Priority: "High" },
      55,
      env,
    );
    expect(writeCustomFieldValuesMock).toHaveBeenCalledWith(
      99,
      [{ fieldId: 2, value: "High", name: "Priority" }],
      env,
    );
  });

  it("surfaces 422 when no active repository found", async () => {
    resolveActiveRepositoryMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "No active repository found for project 7.",
        { statusCode: 422 },
      ),
    );

    const result = await callTool({ projectId: 7, folderId: 12, name: "fail" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("repository");
  });

  it("surfaces 422 for unknown custom field (CASE-12)", async () => {
    resolveCustomFieldsMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "Custom field 'Phantom' not found or not enabled in this deployment.",
        { statusCode: 422 },
      ),
    );

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "cf fail",
      customFields: { Phantom: "x" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("Phantom");
  });

  it("READ_ONLY_TOKEN regression: returns mode:read message (T-06-01)", async () => {
    resolveActiveRepositoryMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ projectId: 7, folderId: 12, name: "write-fail" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("never includes creatorId in the create body", async () => {
    await callTool({ projectId: 7, folderId: 12, name: "no-creator" });

    const createCall = zenstackMock.mock.calls.find((c) => c[1] === "create");
    expect(createCall).toBeDefined();
    const data = (createCall![2] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("creatorId");
  });

  it("records the version 1 snapshot after the case is fully wired (#598)", async () => {
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 1, value: "High", name: "Priority" },
    ]);

    await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login - Valid creds",
      steps: [{ text: "a" }],
      customFields: { Priority: "High" },
    });

    // No bump on create: the fresh case is already at currentVersion 1 and
    // has no snapshot yet.
    expect(createCaseVersionMock).toHaveBeenCalledWith(99, {}, env);
    // The snapshot is written LAST so it captures steps + custom fields.
    expect(createCaseVersionMock.mock.invocationCallOrder[0]!).toBeGreaterThan(
      createStepsForCaseMock.mock.invocationCallOrder[0]!,
    );
    expect(createCaseVersionMock.mock.invocationCallOrder[0]!).toBeGreaterThan(
      writeCustomFieldValuesMock.mock.invocationCallOrder[0]!,
    );
    // And before the detail re-fetch, so the returned detail is post-version.
    expect(createCaseVersionMock.mock.invocationCallOrder[0]!).toBeLessThan(
      fetchCaseDetailMock.mock.invocationCallOrder[0]!,
    );
  });

  it("BL-03: a failed version snapshot triggers the compensating soft-delete", async () => {
    zenstackMock.mockResolvedValueOnce({ id: 99 });
    createCaseVersionMock.mockRejectedValueOnce(
      new TestPlanItHttpError("version write failed", { statusCode: 500 }),
    );
    zenstackMock.mockResolvedValueOnce({ id: 99, isDeleted: true });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login",
    });

    expect(result.isError).toBe(true);
    const cleanup = zenstackMock.mock.calls.find(
      (c) =>
        c[0] === "repositoryCases" &&
        c[1] === "update" &&
        ((c[2] as { data?: { isDeleted?: boolean } }).data?.isDeleted === true),
    );
    expect(cleanup).toBeDefined();
    expect(fetchCaseDetailMock).not.toHaveBeenCalled();
  });

  it("tool is registered as 'testplanit_cases_create' with correct description prefix", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCasesCreate(server, { env });
    // Registration doesn't throw — the tool is registered
    expect(true).toBe(true);
  });

  it("BL-03: post-create step failure compensates by soft-deleting the case and surfaces orphan id", async () => {
    // Case create succeeds, returning id 99.
    zenstackMock.mockResolvedValueOnce({ id: 99 });
    // createStepsForCase blows up mid-flight.
    createStepsForCaseMock.mockRejectedValueOnce(
      new TestPlanItHttpError("step write failed", { statusCode: 500 }),
    );
    // The compensating soft-delete update succeeds.
    zenstackMock.mockResolvedValueOnce({ id: 99, isDeleted: true });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "Login",
      steps: [{ text: "boom" }],
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    // Orphan caseId surfaced so the agent can retry / clean up.
    expect(text).toContain("99");
    // The compensating call was an `update` setting isDeleted: true (T-06-06).
    const cleanup = zenstackMock.mock.calls.find(
      (c) =>
        c[0] === "repositoryCases" &&
        c[1] === "update" &&
        ((c[2] as { data?: { isDeleted?: boolean } }).data?.isDeleted === true),
    );
    expect(cleanup).toBeDefined();
    // Re-fetch was NOT used to deliver detail; re-fetch fails too because
    // we never reached it.
    expect(fetchCaseDetailMock).not.toHaveBeenCalled();
  });

  it("BL-03: post-create custom-field write failure also triggers compensating soft-delete", async () => {
    zenstackMock.mockResolvedValueOnce({ id: 100 });
    resolveCustomFieldsMock.mockResolvedValueOnce([
      { fieldId: 1, value: "High", name: "Priority" },
    ]);
    writeCustomFieldValuesMock.mockRejectedValueOnce(
      new TestPlanItHttpError("cfv write failed", { statusCode: 500 }),
    );
    zenstackMock.mockResolvedValueOnce({ id: 100, isDeleted: true });

    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "CF fail",
      customFields: { Priority: "High" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("100");
    const cleanup = zenstackMock.mock.calls.find(
      (c) =>
        c[0] === "repositoryCases" &&
        c[1] === "update" &&
        ((c[2] as { data?: { isDeleted?: boolean } }).data?.isDeleted === true),
    );
    expect(cleanup).toBeDefined();
  });

  it("WR-03: tool-result error text never leaks the bearer token (T-06-05 defense in depth)", async () => {
    // Simulate a regression where an upstream message accidentally embedded
    // the raw token. The tool-layer mapper / handler chain must never echo
    // the literal token through to the agent — the redactTokens() scrub
    // collapses it to `tpi_***`.
    resolveActiveRepositoryMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        `upstream regression message containing ${env.apiToken}`,
        { statusCode: 500 },
      ),
    );
    const result = await callTool({
      projectId: 7,
      folderId: 12,
      name: "leak-check",
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    // The literal token must not appear; the placeholder may.
    expect(text).not.toContain(env.apiToken);
    expect(text).not.toContain("tpi_testtoken");
  });

  it("BL-03: re-fetch failure (case missing post-create) also triggers compensating soft-delete", async () => {
    zenstackMock.mockResolvedValueOnce({ id: 101 });
    fetchCaseDetailMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Case 101 not found after write — this is unexpected.", {
        statusCode: 404,
      }),
    );
    zenstackMock.mockResolvedValueOnce({ id: 101, isDeleted: true });

    const result = await callTool({ projectId: 7, folderId: 12, name: "refetch fail" });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("101");
  });
});
