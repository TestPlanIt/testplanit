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
  markdown: "# Test\n\nA short doc",
};

function makeRequest(body: Record<string, unknown> = VALID_BODY) {
  return new Request(
    "http://localhost:3000/api/llm/parse-markdown-test-cases",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  ) as unknown as import("next/server").NextRequest;
}

const VALID_MARKDOWN_RESPONSE = JSON.stringify({
  testCases: [{ name: "TC-1", steps: [] }],
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/llm/parse-markdown-test-cases", () => {
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
      temperature: 0.7,
      maxOutputTokens: 2048,
    });

    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 8192,
      defaultMaxTokens: 4096,
    });

    mockChat.mockResolvedValue({
      content: VALID_MARKDOWN_RESPONSE,
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      finishReason: "stop",
    });
  });

  // ── Test TOKEN-03-a: sends maxTokens from llmProviderConfig.defaultMaxTokens ─

  it("TOKEN-03-a: sends maxTokens from llmProviderConfig.defaultMaxTokens (no Math.max floor)", async () => {
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 8192,
      defaultMaxTokens: 1500,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[1].maxTokens).toBe(1500);
  });

  // ── Test TOKEN-03-b: falls back to resolvedPrompt.maxOutputTokens ──────────

  it("TOKEN-03-b: falls back to resolvedPrompt.maxOutputTokens when llmProviderConfig is null", async () => {
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue(null);

    mockPromptResolverResolve.mockResolvedValue({
      systemPrompt: "System prompt",
      temperature: 0.7,
      maxOutputTokens: 2048,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[1].maxTokens).toBe(2048);
  });

  // ── Test TOKEN-06-a: returns 422 when document exceeds context budget ───────

  it("TOKEN-06-a: returns 422 with error message when document exceeds context window budget (before LLM call)", async () => {
    // Tiny budget: maxTokensPerRequest=100, contentBudget ≈ floor(100*0.65) - systemPromptTokens
    // markdown: "A".repeat(10000) = ~2500 tokens >> budget
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 100,
      defaultMaxTokens: 4096,
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ projectId: 1, markdown: "A".repeat(10000) })
    );

    expect(res.status).toBe(422);

    const data = await res.json();
    expect(data.error).toContain("Document exceeds context window");

    // LLM must NOT have been called
    expect(mockChat).not.toHaveBeenCalled();
  });

  // ── Test TOKEN-06-b: calls manager.chat() normally when within budget ───────

  it("TOKEN-06-b: calls manager.chat() normally when document is within budget", async () => {
    // Large budget — small document fits easily
    mockPrismaLlmProviderConfigFindFirst.mockResolvedValue({
      id: 1,
      llmIntegrationId: 42,
      maxTokensPerRequest: 128000,
      defaultMaxTokens: 4096,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: 1, markdown: "# Short doc\n\nHello world." }));
    expect(res.status).toBe(200);

    expect(mockChat).toHaveBeenCalled();
  });

  // ── Test RETRY-01: manager.chat() called with SYNC_RETRY_PROFILE as 3rd arg ─

  it("RETRY-01: manager.chat() called with { maxRetries: 1, baseDelayMs: 1000 } as third argument", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const chatCall = mockChat.mock.calls[0]!;
    expect(chatCall[2]).toEqual({ maxRetries: 1, baseDelayMs: 1000 });
  });

  // ── Test RETRY-04-a: returns 422 when finishReason === "length" ──────────

  it("RETRY-04-a: returns 422 with truncated=true and tokens object when finishReason === 'length'", async () => {
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
    expect(data.truncated).toBe(true);
    expect(data.tokens).toBeDefined();
    expect(typeof data.tokens.used).toBe("number");
  });

  // ── Test RETRY-04-b: processes response normally when finishReason === "stop" ─

  it("RETRY-04-b: processes response normally (status 200, success: true) when finishReason === 'stop'", async () => {
    mockChat.mockResolvedValue({
      content: VALID_MARKDOWN_RESPONSE,
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
