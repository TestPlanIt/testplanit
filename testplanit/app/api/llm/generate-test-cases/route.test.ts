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
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLlmManagerGetInstance: vi.fn(),
  mockResolveIntegration: vi.fn(),
  mockChat: vi.fn(),
  mockPromptResolverResolve: vi.fn(),
  mockPrismaProjectsFindFirst: vi.fn(),
  mockPrismaLlmProviderConfigFindFirst: vi.fn(),
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

function makeRequest(body: Record<string, unknown> = VALID_BODY): Request {
  return new Request("http://localhost:3000/api/llm/generate-test-cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
