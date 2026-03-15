import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock hoisting — safe to reference in factories
const {
  mockPrisma,
  mockGetServerAuthSession,
  mockCheckProjectHasCodeContext,
} = vi.hoisted(() => ({
  mockPrisma: {
    projectLlmIntegration: { findFirst: vi.fn() },
    projectCodeRepositoryConfig: { findUnique: vi.fn() },
  },
  mockGetServerAuthSession: vi.fn(),
  mockCheckProjectHasCodeContext: vi.fn(),
}));

// Mock all server-side dependencies to prevent env var access errors
vi.mock("~/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));
vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: { getInstance: vi.fn() },
}));
vi.mock("~/lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: vi.fn(),
}));
vi.mock("~/lib/llm/constants", () => ({
  LLM_FEATURES: { EXPORT_CODE_GENERATION: "export_code_generation" },
}));
vi.mock("~/lib/llm/services/code-context.service", () => ({
  CodeContextService: {
    assembleContext: vi.fn(),
    checkProjectHasCodeContext: mockCheckProjectHasCodeContext,
  },
}));

import { formatAiError, stripMarkdownFences } from "~/utils/ai-export-helpers";
import { checkAiExportAvailable } from "./aiExportActions";

describe("stripMarkdownFences", () => {
  it("strips opening fence with language tag", () => {
    expect(stripMarkdownFences("```typescript\nconst x = 1;\n```")).toBe(
      "const x = 1;"
    );
  });

  it("strips opening fence without language tag", () => {
    expect(stripMarkdownFences("```\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("strips fences with Windows-style line endings", () => {
    expect(stripMarkdownFences("```ts\r\nconst x = 1;\r\n```")).toBe(
      "const x = 1;"
    );
  });

  it("returns plain code unchanged", () => {
    expect(stripMarkdownFences("const x = 1;")).toBe("const x = 1;");
  });

  it("trims surrounding whitespace", () => {
    expect(stripMarkdownFences("  const x = 1;  ")).toBe("const x = 1;");
  });

  it("handles empty string", () => {
    expect(stripMarkdownFences("")).toBe("");
  });

  it("strips fences with trailing whitespace after closing", () => {
    expect(stripMarkdownFences("```python\nprint('hi')\n```  ")).toBe(
      "print('hi')"
    );
  });

  it("handles multiline code blocks", () => {
    const code =
      "```typescript\nimport { test } from 'vitest';\n\ntest('hello', () => {\n  expect(true).toBe(true);\n});\n```";
    const result = stripMarkdownFences(code);
    expect(result).toContain("import { test }");
    expect(result).toContain("expect(true)");
    expect(result).not.toMatch(/^```/);
    expect(result).not.toMatch(/```$/);
  });
});

describe("formatAiError", () => {
  it("returns generic message for non-Error values", () => {
    expect(formatAiError("oops")).toBe("AI generation failed");
    expect(formatAiError(42)).toBe("AI generation failed");
    expect(formatAiError(null)).toBe("AI generation failed");
    expect(formatAiError(undefined)).toBe("AI generation failed");
  });

  it("returns Error.message for simple errors", () => {
    expect(formatAiError(new Error("Something went wrong"))).toBe(
      "Something went wrong"
    );
  });

  it("chains cause messages", () => {
    const inner = new Error("ECONNREFUSED");
    const outer = new Error("fetch failed", { cause: inner });
    expect(formatAiError(outer)).toBe("fetch failed: ECONNREFUSED");
  });

  it("handles deep cause chains", () => {
    const innermost = new Error("ECONNREFUSED");
    const middle = new Error("connect failed", { cause: innermost });
    const outer = new Error("fetch failed", { cause: middle });
    expect(formatAiError(outer)).toBe(
      "fetch failed: connect failed: ECONNREFUSED"
    );
  });

  it("extracts code from non-Error cause objects", () => {
    const cause = { code: "ENOTFOUND" };
    const err = new Error("fetch failed", { cause });
    expect(formatAiError(err)).toBe("fetch failed: ENOTFOUND");
  });

  it("handles cause with no code property", () => {
    const cause = { something: "else" };
    const err = new Error("fetch failed", { cause: cause as any });
    expect(formatAiError(err)).toBe("fetch failed");
  });
});

describe("checkAiExportAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unavailable when not authenticated", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const result = await checkAiExportAvailable({ projectId: 1 });
    expect(result).toEqual({
      available: false,
      reason: "not_authenticated",
    });
  });

  it("returns unavailable when no LLM integration exists", async () => {
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
    mockPrisma.projectLlmIntegration.findFirst.mockResolvedValue(null);

    const result = await checkAiExportAvailable({ projectId: 1 });
    expect(result).toEqual({ available: false, reason: "no_llm" });
  });

  it("returns available with hasCodeContext=true when LLM and repo exist", async () => {
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
    mockPrisma.projectLlmIntegration.findFirst.mockResolvedValue({
      llmIntegrationId: 10,
    });
    mockCheckProjectHasCodeContext.mockResolvedValue(true);

    const result = await checkAiExportAvailable({ projectId: 1 });
    expect(result).toEqual({ available: true, hasCodeContext: true });
  });

  it("returns available with hasCodeContext=false when LLM exists but no repo", async () => {
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
    mockPrisma.projectLlmIntegration.findFirst.mockResolvedValue({
      llmIntegrationId: 10,
    });
    mockCheckProjectHasCodeContext.mockResolvedValue(false);

    const result = await checkAiExportAvailable({ projectId: 1 });
    expect(result).toEqual({ available: true, hasCodeContext: false });
  });
});
