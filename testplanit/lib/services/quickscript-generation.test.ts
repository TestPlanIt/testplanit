import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  mockResolve,
  mockResolveIntegration,
  mockChat,
  mockAssembleContext,
  mockCheckProjectHasCodeContext,
} = vi.hoisted(() => ({
  mockDb: {
    caseExportTemplate: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    caseExportTemplateProjectAssignment: { findMany: vi.fn() },
    projects: { findUnique: vi.fn() },
    projectLlmIntegration: { count: vi.fn() },
    llmIntegration: { count: vi.fn() },
    llmProviderConfig: { findFirst: vi.fn() },
    projectCodeRepositoryConfig: { findUnique: vi.fn() },
  },
  mockResolve: vi.fn(),
  mockResolveIntegration: vi.fn(),
  mockChat: vi.fn(),
  mockAssembleContext: vi.fn(),
  mockCheckProjectHasCodeContext: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ baseDb: mockDb }));
vi.mock("~/lib/llm/constants", () => ({
  LLM_FEATURES: { EXPORT_CODE_GENERATION: "export_code_generation" },
}));
vi.mock("~/lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class {
    resolve(...args: unknown[]) {
      return mockResolve(...args);
    }
  },
}));
vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    getInstance: vi.fn(() => ({
      resolveIntegration: mockResolveIntegration,
      chat: mockChat,
    })),
  },
}));
vi.mock("~/lib/llm/services/code-context.service", () => ({
  CodeContextService: {
    assembleContext: mockAssembleContext,
    checkProjectHasCodeContext: mockCheckProjectHasCodeContext,
  },
}));

import {
  generateQuickScript,
  getQuickScriptReadiness,
  resolveQuickScriptTemplate,
} from "./quickscript-generation";

const template = {
  id: 3,
  name: "Playwright",
  framework: "Playwright",
  language: "TypeScript",
  fileExtension: ".spec.ts",
  headerBody: null,
  footerBody: null,
  templateBody: "test('{{name}}', async () => {});",
  isDefault: true,
  isEnabled: true,
  isDeleted: false,
};

const caseData = {
  name: "Login",
  id: 456,
  displayKey: null,
  folder: "Auth",
  state: "Draft",
  estimate: null,
  automated: false,
  tags: "",
  createdBy: "Alice",
  createdAt: "2026-01-01",
  steps: [{ order: 1, step: "Open /login", expectedResult: "Form renders" }],
  fields: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue({
    systemPrompt: "System {{FRAMEWORK}}/{{LANGUAGE}}",
    userPrompt: "Case {{CASE_NAME}}\n{{STEPS_TEXT}}\n{{CODE_CONTEXT}}",
    temperature: 0.2,
    maxOutputTokens: 4096,
    source: "default",
  });
  mockResolveIntegration.mockResolvedValue({ integrationId: 11, model: "gpt" });
  mockChat.mockResolvedValue({ content: "```ts\ngenerated code\n```" });
  mockAssembleContext.mockResolvedValue({
    context: "",
    filesUsed: [],
    tokenEstimate: 0,
    truncated: false,
  });
  mockCheckProjectHasCodeContext.mockResolvedValue(false);
  mockDb.caseExportTemplate.findUnique.mockResolvedValue(template);
  mockDb.llmProviderConfig.findFirst.mockResolvedValue({
    defaultMaxTokens: 8000,
    maxTokensPerRequest: 4096,
  });
  mockDb.projectCodeRepositoryConfig.findUnique.mockResolvedValue(null);
});

describe("resolveQuickScriptTemplate", () => {
  it("returns an explicit template that is assigned to the project", async () => {
    mockDb.caseExportTemplateProjectAssignment.findMany.mockResolvedValue([
      { templateId: 3 },
    ]);
    mockDb.caseExportTemplate.findFirst.mockResolvedValue(template);

    const result = await resolveQuickScriptTemplate(1, 3);
    expect(result?.id).toBe(3);
  });

  it("rejects an explicit template not assigned to a scoped project", async () => {
    mockDb.caseExportTemplateProjectAssignment.findMany.mockResolvedValue([
      { templateId: 99 },
    ]);
    mockDb.caseExportTemplate.findFirst.mockResolvedValue({
      ...template,
      id: 3,
    });

    const result = await resolveQuickScriptTemplate(1, 3);
    expect(result).toBeNull();
  });

  it("prefers the project default over the global default", async () => {
    mockDb.caseExportTemplateProjectAssignment.findMany.mockResolvedValue([]);
    mockDb.caseExportTemplate.findMany.mockResolvedValue([
      { ...template, id: 1, isDefault: true },
      { ...template, id: 2, isDefault: false },
    ]);
    mockDb.projects.findUnique.mockResolvedValue({
      defaultCaseExportTemplateId: 2,
    });

    const result = await resolveQuickScriptTemplate(1);
    expect(result?.id).toBe(2);
  });

  it("falls back to the global default when no project default is set", async () => {
    mockDb.caseExportTemplateProjectAssignment.findMany.mockResolvedValue([]);
    mockDb.caseExportTemplate.findMany.mockResolvedValue([
      { ...template, id: 1, isDefault: false },
      { ...template, id: 2, isDefault: true },
    ]);
    mockDb.projects.findUnique.mockResolvedValue({
      defaultCaseExportTemplateId: null,
    });

    const result = await resolveQuickScriptTemplate(1);
    expect(result?.id).toBe(2);
  });

  it("returns null when no candidates exist", async () => {
    mockDb.caseExportTemplateProjectAssignment.findMany.mockResolvedValue([]);
    mockDb.caseExportTemplate.findMany.mockResolvedValue([]);

    const result = await resolveQuickScriptTemplate(1);
    expect(result).toBeNull();
  });
});

describe("getQuickScriptReadiness", () => {
  it("reports enabled + LLM + code context", async () => {
    mockDb.projects.findUnique.mockResolvedValue({ quickScriptEnabled: true });
    mockDb.projectLlmIntegration.count.mockResolvedValue(1);
    mockDb.llmIntegration.count.mockResolvedValue(0);
    mockCheckProjectHasCodeContext.mockResolvedValue(true);

    const result = await getQuickScriptReadiness(1);
    expect(result).toEqual({
      quickScriptEnabled: true,
      hasActiveLlm: true,
      hasCodeContext: true,
    });
  });

  it("uses a global LLM integration as a fallback", async () => {
    mockDb.projects.findUnique.mockResolvedValue({ quickScriptEnabled: false });
    mockDb.projectLlmIntegration.count.mockResolvedValue(0);
    mockDb.llmIntegration.count.mockResolvedValue(2);
    mockCheckProjectHasCodeContext.mockResolvedValue(false);

    const result = await getQuickScriptReadiness(1);
    expect(result.hasActiveLlm).toBe(true);
    expect(result.quickScriptEnabled).toBe(false);
  });
});

describe("generateQuickScript", () => {
  it("returns AI output with fences stripped on success", async () => {
    const result = await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData],
      userId: "u1",
      mode: "single",
    });

    expect(result.generatedBy).toBe("ai");
    expect(result.code).toBe("generated code");
    expect(result.caseId).toBe(456);
    expect(result.caseName).toBe("Login");
  });

  it("falls back to the Mustache render when no LLM integration resolves", async () => {
    mockResolveIntegration.mockResolvedValue(null);

    const result = await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData],
      userId: "u1",
      mode: "single",
    });

    expect(result.generatedBy).toBe("template");
    expect(result.error).toBe("No active LLM integration");
    expect(result.code).toBe("test('Login', async () => {});");
  });

  it("falls back to the Mustache render when the LLM call throws", async () => {
    mockChat.mockRejectedValue(new Error("provider down"));

    const result = await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData],
      userId: "u1",
      mode: "single",
    });

    expect(result.generatedBy).toBe("template");
    expect(result.error).toContain("provider down");
    expect(result.code).toBe("test('Login', async () => {});");
  });

  it("substitutes {{CASE_ID}} so single-mode prompts can bracket the case id", async () => {
    mockResolve.mockResolvedValue({
      systemPrompt: "System",
      userPrompt: "TEST CASE [{{CASE_ID}}]: {{CASE_NAME}}\n{{STEPS_TEXT}}",
      temperature: 0.2,
      maxOutputTokens: 4096,
      source: "default",
    });

    await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData],
      userId: "u1",
      mode: "single",
    });

    const request = mockChat.mock.calls[0][1];
    const userMessage = request.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    // The importer's default matching resolves bracketed ids in test names
    // back to existing cases, so the id must reach the prompt.
    expect(userMessage.content).toContain("TEST CASE [456]: Login");
  });

  it("brackets each case id in combined mode and instructs bracketed test names", async () => {
    await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData, { ...caseData, id: 457, name: "Logout" }],
      userId: "u1",
      mode: "batch",
    });

    const request = mockChat.mock.calls[0][1];
    const userMessage = request.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    expect(userMessage.content).toContain("Test Case 1 [456]: Login");
    expect(userMessage.content).toContain("Test Case 2 [457]: Logout");
    expect(userMessage.content).toContain(
      "case ID in square brackets before the case name"
    );
  });

  it("names a combined batch result and caps output at the provider ceiling", async () => {
    mockDb.llmProviderConfig.findFirst.mockResolvedValue({
      defaultMaxTokens: 8000,
      maxTokensPerRequest: 1000,
    });

    const result = await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData, { ...caseData, id: 457, name: "Logout" }],
      userId: "u1",
      mode: "batch",
    });

    expect(result.generatedBy).toBe("ai");
    expect(result.caseName).toBe("Combined (2 tests)");
    const request = mockChat.mock.calls[0][1];
    expect(request.maxTokens).toBe(1000);
  });

  it("degrades to no-context generation when repo context assembly fails", async () => {
    // A connected repo whose context assembly throws (e.g. the git host
    // rate-limiting a live content fetch) must NOT fail the generation.
    mockDb.projectCodeRepositoryConfig.findUnique.mockResolvedValue({ id: 5 });
    mockAssembleContext.mockRejectedValue(
      new Error("Rate limit exceeded. Try again in a few minutes.")
    );

    const result = await generateQuickScript({
      projectId: 1,
      templateId: 3,
      cases: [caseData],
      userId: "u1",
      mode: "single",
    });

    expect(result.generatedBy).toBe("ai");
    expect(result.code).toBe("generated code");
    expect(result.contextFiles).toEqual([]);
  });

  it("throws when the template does not exist", async () => {
    mockDb.caseExportTemplate.findUnique.mockResolvedValue(null);

    await expect(
      generateQuickScript({
        projectId: 1,
        templateId: 999,
        cases: [caseData],
        userId: "u1",
        mode: "single",
      })
    ).rejects.toThrow("Export template not found");
  });
});
