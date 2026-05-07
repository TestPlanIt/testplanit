import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCasesGet } from "./get.js";
import { registerCases } from "./index.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

function makeRawCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    name: "Login flow",
    source: "MANUAL",
    automated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: { id: 7, name: "TestProject" },
    folder: { id: 12, name: "Auth", parentId: 5 },
    state: { id: 3, name: "Active" },
    creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
    tags: [{ id: 1, name: "smoke" }],
    issues: [],
    steps: [],
    caseFieldValues: [],
    linksFrom: [],
    linksTo: [],
    ...overrides,
  };
}

function makeProseMirrorDoc(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

/** Helper: create a server, register the get tool, connect a client */
async function setupGetClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesGet(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

describe("registerCasesGet", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("happy path: returns full detail shape with folder breadcrumb", async () => {
    // First call: findUnique on repositoryCases
    mockZenstack.mockResolvedValueOnce(makeRawCase());
    // Second call: breadcrumb walk — parent folder id=5
    mockZenstack.mockResolvedValueOnce({ id: 5, name: "Regression", parentId: null });

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    expect(result.isError).toBeFalsy();
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    const breadcrumb = structured.folderBreadcrumb as Array<{ id: number; name: string }>;
    expect(breadcrumb).toEqual([
      { id: 5, name: "Regression" },
      { id: 12, name: "Auth" },
    ]);
    expect(structured.folderFullPath).toBe("Regression / Auth");
  });

  it("steps are extracted from ProseMirror JSON to plain text", async () => {
    const caseWithSteps = makeRawCase({
      steps: [
        {
          id: 1,
          order: 0,
          step: makeProseMirrorDoc("Open login page"),
          expectedResult: makeProseMirrorDoc("Login form visible"),
        },
      ],
    });
    mockZenstack.mockResolvedValueOnce(caseWithSteps);
    // Root folder — no breadcrumb walk
    const rootFolderCase = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      steps: [
        {
          id: 1,
          order: 0,
          step: makeProseMirrorDoc("Open login page"),
          expectedResult: makeProseMirrorDoc("Login form visible"),
        },
      ],
    });
    mockZenstack.mockReset();
    mockZenstack.mockResolvedValueOnce(rootFolderCase);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    const steps = structured.steps as Array<{ step: string; expectedResult: string }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("Open login page");
    expect(steps[0].expectedResult).toBe("Login form visible");
  });

  it("custom fields are returned as flat dict keyed by displayName", async () => {
    const caseWithFields = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      caseFieldValues: [
        { value: "High", field: { displayName: "Priority" } },
      ],
    });
    mockZenstack.mockResolvedValueOnce(caseWithFields);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    expect(structured.customFields).toEqual({ Priority: "High" });
  });

  it("issues are included in the response", async () => {
    const caseWithIssues = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      issues: [
        {
          id: 1,
          externalKey: "JIRA-1",
          integration: { provider: "JIRA" },
          title: "Bug",
          externalStatus: "Open",
        },
      ],
    });
    mockZenstack.mockResolvedValueOnce(caseWithIssues);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    const issues = structured.issues as Array<Record<string, unknown>>;
    expect(issues).toHaveLength(1);
    expect(issues[0].externalKey).toBe("JIRA-1");
  });

  it("linked automated tests: MANUAL source excluded, automated included from linksFrom+linksTo", async () => {
    const caseWithLinks = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      linksFrom: [
        { caseB: { id: 9, name: "automated_test_a", source: "JUNIT" } },
        { caseB: { id: 10, name: "manual_b", source: "MANUAL" } },
      ],
      linksTo: [
        { caseA: { id: 11, name: "automated_test_c", source: "TESTNG" } },
      ],
    });
    mockZenstack.mockResolvedValueOnce(caseWithLinks);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    const linkedTests = structured.linkedAutomatedTests as Array<{ id: number }>;
    expect(linkedTests).toHaveLength(2);
    const ids = linkedTests.map((t) => t.id);
    expect(ids).toContain(9);
    expect(ids).toContain(11);
    expect(ids).not.toContain(10);
  });

  it("root folder case: no breadcrumb parent walk (zenstack called only once)", async () => {
    const rootCase = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
    });
    mockZenstack.mockResolvedValueOnce(rootCase);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    expect(result.isError).toBeFalsy();
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;
    const breadcrumb = structured.folderBreadcrumb as Array<{ id: number }>;
    expect(breadcrumb).toEqual([{ id: 5, name: "Root" }]);
  });

  it("case not found (zenstack throws 422) — returns isError: true", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("HTTP 422 from /api/model/repositoryCases/findUnique", {
        statusCode: 422,
      }),
    );

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 9999 },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("422");
  });

  it("error path: non-Http error (network timeout) — returns isError: true with network message", async () => {
    mockZenstack.mockRejectedValueOnce(new Error("Connection timeout"));

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Network");
  });

  it("tool registration: tool is named testplanit_cases_get with correct description prefix", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCasesGet(server, deps);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_cases_get");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/^Fetch a single test case/);
  });

  it("registerCases registers BOTH list and get tools", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCases(server, deps);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("testplanit_cases_list");
    expect(names).toContain("testplanit_cases_get");
  });

  // ── Phase 8 (D8-02) inline codeRepository on cases_get ──────────────────

  it("Phase-8: codeRepository populated when project has a config (GITHUB)", async () => {
    const caseWithRepo = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      project: {
        id: 7,
        name: "TestProject",
        codeRepositoryConfig: {
          repository: {
            id: 5,
            name: "acme/tools",
            provider: "GITHUB",
            status: "ACTIVE",
            lastTestedAt: null,
            settings: {
              owner: "acme",
              repo: "tools",
              personalAccessToken: "pat_secret",
            },
          },
        },
      },
    });
    mockZenstack.mockResolvedValueOnce(caseWithRepo);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    expect(structured.codeRepository).toEqual({
      id: 5,
      name: "acme/tools",
      type: "GITHUB",
      url: "https://github.com/acme/tools",
    });
  });

  it("Phase-8: codeRepository null when project has no codeRepositoryConfig", async () => {
    const caseWithoutRepo = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      project: { id: 7, name: "TestProject", codeRepositoryConfig: null },
    });
    mockZenstack.mockResolvedValueOnce(caseWithoutRepo);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    expect(structured.codeRepository).toBeNull();
  });

  it("Phase-8: codeRepository never includes credentials / personalAccessToken (defense in depth)", async () => {
    const caseWithRepo = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      project: {
        id: 7,
        name: "TestProject",
        codeRepositoryConfig: {
          repository: {
            id: 5,
            name: "acme/tools",
            provider: "GITHUB",
            status: "ACTIVE",
            lastTestedAt: null,
            settings: {
              owner: "acme",
              repo: "tools",
              personalAccessToken: "pat_secret",
              webhookSecret: "secret_xyz",
            },
          },
        },
      },
    });
    mockZenstack.mockResolvedValueOnce(caseWithRepo);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    const serialized = JSON.stringify(structured.codeRepository);
    expect(serialized).not.toMatch(/personalAccessToken/i);
    expect(serialized).not.toMatch(/webhookSecret/i);
    expect(serialized).not.toMatch(/credentials/i);
    expect(serialized).not.toMatch(/pat_secret/);
    expect(serialized).not.toMatch(/secret_xyz/);
  });

  it("Phase-8: CASE_DETAIL_INCLUDE selects project.codeRepositoryConfig.repository chain (no credentials)", async () => {
    mockZenstack.mockResolvedValueOnce(
      makeRawCase({
        folder: { id: 5, name: "Root", parentId: null },
        project: { id: 7, name: "TestProject", codeRepositoryConfig: null },
      }),
    );

    const { client } = await setupGetClient();
    await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    // The first zenstack call carries the include shape we assert on.
    const calls = mockZenstack.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const body = calls[0][2] as {
      include: {
        project: {
          select: {
            id: boolean;
            name: boolean;
            codeRepositoryConfig: {
              select: { repository: { select: Record<string, boolean> } };
            };
          };
        };
      };
    };
    const projectSelect = body.include.project.select;
    expect(projectSelect.id).toBe(true);
    expect(projectSelect.name).toBe(true);
    const repoSelect = projectSelect.codeRepositoryConfig.select.repository.select;
    expect(repoSelect.id).toBe(true);
    expect(repoSelect.name).toBe(true);
    expect(repoSelect.provider).toBe(true);
    expect(repoSelect.status).toBe(true);
    expect(repoSelect.lastTestedAt).toBe(true);
    expect(repoSelect.settings).toBe(true);
    // Defense in depth: credentials NEVER selected.
    expect(repoSelect).not.toHaveProperty("credentials");
  });

  it("Phase-8: regression — existing case-detail fields still populated when codeRepository present", async () => {
    const caseWithEverything = makeRawCase({
      folder: { id: 5, name: "Root", parentId: null },
      project: {
        id: 7,
        name: "TestProject",
        codeRepositoryConfig: {
          repository: {
            id: 5,
            name: "acme/tools",
            provider: "GITHUB",
            status: "ACTIVE",
            lastTestedAt: null,
            settings: { owner: "acme", repo: "tools" },
          },
        },
      },
      caseFieldValues: [
        { value: "High", field: { displayName: "Priority" } },
      ],
      issues: [
        {
          id: 1,
          externalKey: "JIRA-1",
          integration: { provider: "JIRA" },
          title: "Bug",
          externalStatus: "Open",
        },
      ],
      linksFrom: [
        { caseB: { id: 9, name: "auto_a", source: "JUNIT" } },
      ],
      steps: [
        {
          id: 1,
          order: 0,
          step: makeProseMirrorDoc("Step body"),
          expectedResult: makeProseMirrorDoc("Expected"),
        },
      ],
    });
    mockZenstack.mockResolvedValueOnce(caseWithEverything);

    const { client } = await setupGetClient();
    const result = await client.callTool({
      name: "testplanit_cases_get",
      arguments: { caseId: 101 },
    });

    const structured = (result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>;
    expect(structured.customFields).toEqual({ Priority: "High" });
    const issues = structured.issues as Array<Record<string, unknown>>;
    expect(issues[0].externalKey).toBe("JIRA-1");
    const linkedTests = structured.linkedAutomatedTests as Array<{ id: number }>;
    expect(linkedTests.map((l) => l.id)).toContain(9);
    const steps = structured.steps as Array<{ step: string }>;
    expect(steps[0].step).toBe("Step body");
    expect(structured.codeRepository).toEqual({
      id: 5,
      name: "acme/tools",
      type: "GITHUB",
      url: "https://github.com/acme/tools",
    });
  });
});
