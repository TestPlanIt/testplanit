import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockGetServerSession,
  mockLlmManagerGetInstance,
  mockResolveIntegration,
  mockChat,
  mockPromptResolverResolve,
  mockPrismaProjectsFindFirst,
  mockPrismaLlmProviderConfigFindFirst,
  mockPrismaRepositoryFoldersFindMany,
  mockPrismaRepositoryCasesFindMany,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLlmManagerGetInstance: vi.fn(),
  mockResolveIntegration: vi.fn(),
  mockChat: vi.fn(),
  mockPromptResolverResolve: vi.fn(),
  mockPrismaProjectsFindFirst: vi.fn(),
  mockPrismaLlmProviderConfigFindFirst: vi.fn(),
  mockPrismaRepositoryFoldersFindMany: vi.fn(),
  mockPrismaRepositoryCasesFindMany: vi.fn(),
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    getInstance: (...args: any[]) => mockLlmManagerGetInstance(...args),
  },
}));

vi.mock("@/lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class {
    resolve = (...args: any[]) => mockPromptResolverResolve(...args);
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projects: {
      findFirst: (...args: any[]) => mockPrismaProjectsFindFirst(...args),
    },
    llmProviderConfig: {
      findFirst: (...args: any[]) => mockPrismaLlmProviderConfigFindFirst(...args),
    },
    repositoryFolders: {
      findMany: (...args: any[]) => mockPrismaRepositoryFoldersFindMany(...args),
    },
    repositoryCases: {
      findMany: (...args: any[]) => mockPrismaRepositoryCasesFindMany(...args),
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  projectId: 1,
  issue: {
    key: "PROJ-1",
    title: "Test",
    description: "Desc",
    status: "Open",
  },
  template: {
    id: 1,
    name: "Default",
    fields: [],
  },
  context: {
    folderContext: 0,
  },
};

function makeRequest(body: Record<string, unknown> = VALID_BODY) {
  return new Request("http://localhost:3000/api/llm/generate-test-cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const VALID_TEST_CASES_RESPONSE = JSON.stringify({
  testCases: [
    {
      id: "tc_1",
      name: "Test login flow",
      fieldValues: {},
      automated: false,
    },
  ],
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/llm/generate-test-cases", () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockManager = {
      resolveIntegration: mockResolveIntegration,
      chat: mockChat,
    };

    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", access: "ADMIN" },
    });

    mockLlmManagerGetInstance.mockReturnValue(mockManager);

    mockPrismaProjectsFindFirst.mockResolvedValue({
      id: 1,
      projectLlmIntegrations: [],
    });

    mockResolveIntegration.mockResolvedValue({ integrationId: 42 });

    mockPromptResolverResolve.mockResolvedValue({
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
      temperature: 0.7,
      maxOutputTokens: 2048,
      source: "default",
    });

    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 8192,
      defaultMaxTokens: 4096,
      retryAttempts: 3,
      timeout: 30000,
    });

    mockPrismaRepositoryFoldersFindMany.mockResolvedValue([]);
    mockPrismaRepositoryCasesFindMany.mockResolvedValue([]);

    mockChat.mockResolvedValue({
      content: VALID_TEST_CASES_RESPONSE,
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      finishReason: "stop",
    });
  });

  // ── Test 1 (RETRY-02): SYNC_RETRY_PROFILE constant has correct shape ───────

  it("RETRY-02: SYNC_RETRY_PROFILE constant has maxRetries=1, baseDelayMs=1000, maxDelayMs=10000", async () => {
    const { SYNC_RETRY_PROFILE } = await import("@/lib/llm/constants");

    expect(SYNC_RETRY_PROFILE.maxRetries).toBe(1);
    expect(SYNC_RETRY_PROFILE.baseDelayMs).toBe(1000);
    expect(SYNC_RETRY_PROFILE.maxDelayMs).toBe(10000);
  });

  // ── Test 2 (TOKEN-02): Uses defaultMaxTokens from provider config ──────────

  it("TOKEN-02: sends maxTokens from llmProviderConfig.defaultMaxTokens (no Math.max floor)", async () => {
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 8192,
      defaultMaxTokens: 1500,
      retryAttempts: 3,
      timeout: 30000,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[1].maxTokens).toBe(1500);
  });

  // ── Test 3 (TOKEN-02): Falls back to resolvedPrompt.maxOutputTokens when no config ──

  it("TOKEN-02: falls back to resolvedPrompt.maxOutputTokens when llmProviderConfig is null", async () => {
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue(null);

    mockPromptResolverResolve.mockResolvedValue({
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
      temperature: 0.7,
      maxOutputTokens: 2048,
      source: "default",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[1].maxTokens).toBe(2048);
  });

  // ── Test 4 (RETRY-01): manager.chat() receives SYNC_RETRY_PROFILE as 3rd arg ─

  it("RETRY-01: manager.chat() called with { maxRetries: 1, baseDelayMs: 1000 } as 3rd argument", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[2]).toEqual({ maxRetries: 1, baseDelayMs: 1000 });
  });

  // ── Test 5 (RETRY-03): Returns 422 when finishReason is "length" ──────────

  it("RETRY-03: returns 422 with truncation error when finishReason === 'length'", async () => {
    mockChat.mockResolvedValue({
      content: '{"testCases": [',
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 500,
      totalTokens: 600,
      finishReason: "length",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(422);

    const data = await res.json();
    expect(data.error).toContain("truncated");
    expect(data.tokens).toBeDefined();
    expect(data.tokens.used).toBe(600);
  });

  // ── Test 6 (RETRY-03): Returns 200 when finishReason is "stop" ───────────

  it("RETRY-03: returns 200 and processes JSON normally when finishReason === 'stop'", async () => {
    mockChat.mockResolvedValue({
      content: VALID_TEST_CASES_RESPONSE,
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      finishReason: "stop",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.testCases).toBeDefined();
    expect(data.testCases.length).toBeGreaterThan(0);
  });
});

// ─── TOKEN-05 helpers ─────────────────────────────────────────────────────────

function makeLargeExistingCases(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Existing Test Case ${i + 1} with a very long name to consume tokens`,
    template: "Default",
    description:
      "This is a very long description that is designed to consume many tokens in the LLM prompt. ".repeat(
        20
      ),
    steps: Array.from({ length: 5 }, (__, j) => ({
      step: `Step ${j + 1}: Perform a detailed action that has a verbose description to increase token count substantially`,
      expectedResult: `Expected result ${j + 1}: The system should respond in a very specific way that requires detailed explanation`,
    })),
  }));
}

function makeLargeComments(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    author: `author${i + 1}`,
    body: "This comment body is approximately 300 characters long and contains relevant information about the issue that was reported by users during testing. The content is important for understanding the context. ".substring(
      0,
      300
    ),
    created: "2024-01-01",
  }));
}

// ─── TOKEN-05 tests ───────────────────────────────────────────────────────────

describe("TOKEN-05: prompt budget estimation and truncation", () => {
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockManager = {
      resolveIntegration: mockResolveIntegration,
      chat: mockChat,
    };

    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", access: "ADMIN" },
    });

    mockLlmManagerGetInstance.mockReturnValue(mockManager);

    mockPrismaProjectsFindFirst.mockResolvedValue({
      id: 1,
      projectLlmIntegrations: [],
    });

    mockResolveIntegration.mockResolvedValue({ integrationId: 42 });

    mockPromptResolverResolve.mockResolvedValue({
      systemPrompt: "System prompt",
      userPrompt: null,
      temperature: 0.7,
      maxOutputTokens: 2048,
      source: "default",
    });

    mockPrismaRepositoryFoldersFindMany.mockResolvedValue([]);
    mockPrismaRepositoryCasesFindMany.mockResolvedValue([]);

    mockChat.mockResolvedValue({
      content: VALID_TEST_CASES_RESPONSE,
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      finishReason: "stop",
    });
  });

  // ── TOKEN-05-a: existing cases truncated first ────────────────────────────

  it("TOKEN-05-a: removes existing test cases when prompt exceeds contentBudget", async () => {
    // maxTokensPerRequest=500, contentBudget = floor(500*0.65) - systemPromptTokens (~3 tokens)
    // contentBudget ≈ 322; 10 large cases each ~2000 chars = ~500 tokens >> budget
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 500,
      defaultMaxTokens: 256,
    });

    const body = {
      ...VALID_BODY,
      context: {
        folderContext: 0,
        existingTestCases: makeLargeExistingCases(10),
      },
    };

    const { POST } = await import("./route");
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    // Check the userPrompt that was sent to manager.chat
    const chatCall = mockChat.mock.calls[0]!;
    const userPromptSent: string = chatCall[1].messages[1].content;

    // Count how many existing case references appear in the prompt
    const caseMatches = userPromptSent.match(/Existing Test Case \d+/g) ?? [];
    // Should have fewer than 10 existing cases (truncation must have occurred)
    expect(caseMatches.length).toBeLessThan(10);
  });

  // ── TOKEN-05-b: comments truncated after removing all existing cases ──────

  it("TOKEN-05-b: removes comments when over budget after no existing cases remain", async () => {
    // Very tiny budget so even 3 large comments push over
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 300,
      defaultMaxTokens: 256,
    });

    const body = {
      ...VALID_BODY,
      issue: {
        ...VALID_BODY.issue,
        comments: makeLargeComments(3),
      },
      context: {
        folderContext: 0,
        // No existing test cases — so only comments can be truncated
      },
    };

    const { POST } = await import("./route");
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    const userPromptSent: string = chatCall[1].messages[1].content;

    // Count comment author references in the prompt
    const commentMatches = userPromptSent.match(/author\d/g) ?? [];
    // Should have fewer than 3 comments (truncation must have occurred)
    expect(commentMatches.length).toBeLessThan(3);
  });

  // ── TOKEN-05-c: core content never truncated ──────────────────────────────

  it("TOKEN-05-c: issue key, title, description, and userNotes always appear in prompt", async () => {
    // Very small budget — only essential issue content should survive
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 200,
      defaultMaxTokens: 256,
    });

    const body = {
      ...VALID_BODY,
      issue: {
        key: "CORE-999",
        title: "Unique Title CORE999",
        description: "Unique description text CORE999",
        status: "Open",
        priority: "High",
      },
      context: {
        folderContext: 0,
        userNotes: "Unique user notes CORE999",
        existingTestCases: makeLargeExistingCases(5),
      },
    };

    const { POST } = await import("./route");
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    const userPromptSent: string = chatCall[1].messages[1].content;

    // Core content must always appear regardless of truncation
    expect(userPromptSent).toContain("CORE-999");
    expect(userPromptSent).toContain("Unique Title CORE999");
    expect(userPromptSent).toContain("Unique description text CORE999");
    expect(userPromptSent).toContain("Unique user notes CORE999");
  });

  // ── TOKEN-05-d: truncation reported in response metadata ─────────────────

  it("TOKEN-05-d: response metadata includes truncated=true and truncationNote when truncation occurs", async () => {
    // Use a very small token budget so that comments push the prompt over budget.
    // The beforeEach sets systemPrompt to "System prompt" (very short), so the
    // content budget is roughly floor(200*0.65) - ceil(13/4) ≈ 126 tokens.
    // The base user prompt is ~63 tokens; 3 large comments add ~170 tokens total,
    // exceeding the budget and triggering truncation.
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 200,
      defaultMaxTokens: 256,
    });

    const body = {
      ...VALID_BODY,
      issue: {
        ...VALID_BODY.issue,
        comments: makeLargeComments(3),
      },
      context: {
        folderContext: 0,
      },
    };

    const { POST } = await import("./route");
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.metadata.truncated).toBe(true);
    expect(typeof data.metadata.truncationNote).toBe("string");
    expect(data.metadata.truncationNote.length).toBeGreaterThan(0);
  });

  // ── TOKEN-05-e: no truncation when within budget ──────────────────────────

  it("TOKEN-05-e: no truncation when prompt fits within budget", async () => {
    // Very large budget — no truncation needed
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 128000,
      defaultMaxTokens: 4096,
    });

    const body = {
      ...VALID_BODY,
      issue: {
        key: "PROJ-1",
        title: "Small issue",
        description: "Short description",
        status: "Open",
      },
      context: {
        folderContext: 0,
      },
    };

    const { POST } = await import("./route");
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    const data = await res.json();
    // truncated should be false or undefined when no truncation occurs
    expect(data.metadata.truncated === false || data.metadata.truncated === undefined).toBe(true);
    expect(data.metadata.truncationNote).toBeUndefined();
  });
});
