import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    promptConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

import { GET } from "./route";

const createMockRequest = (searchParams: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/admin/prompt-configs/export");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return {
    nextUrl: { searchParams: url.searchParams },
  } as unknown as NextRequest;
};

const mockPromptConfig = {
  id: "config-1",
  name: "Test Config",
  description: "A test configuration",
  isDefault: false,
  isActive: true,
  prompts: [
    {
      id: "prompt-1",
      feature: "test_case_generation",
      systemPrompt: "You are a test case generator.",
      userPrompt: "Generate test cases for: {input}",
      temperature: 0.7,
      maxOutputTokens: 2048,
      llmIntegrationId: 1,
      llmIntegration: { name: "OpenAI Production" },
      modelOverride: "gpt-4o-mini",
    },
    {
      id: "prompt-2",
      feature: "markdown_parsing",
      systemPrompt: "You parse markdown.",
      userPrompt: "Parse: {input}",
      temperature: 0.3,
      maxOutputTokens: 1024,
      llmIntegrationId: null,
      llmIntegration: null,
      modelOverride: null,
    },
  ],
};

describe("GET /api/admin/prompt-configs/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated (no session)", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
      });

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });
  });

  describe("Validation", () => {
    it("returns 400 when id query param is missing", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const request = createMockRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("id");
    });
  });

  describe("GET - export prompt config", () => {
    it("returns 404 when prompt config not found", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(null);

      const request = createMockRequest({ id: "nonexistent" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 200 with exported config JSON", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.name).toBe("Test Config");
      expect(data.description).toBe("A test configuration");
      expect(data.isDefault).toBe(false);
      expect(data.isActive).toBe(true);
    });

    it("includes prompts array in export", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(Array.isArray(data.prompts)).toBe(true);
      expect(data.prompts).toHaveLength(2);
    });

    it("includes llmIntegrationName (human-readable name) not the raw ID", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      const firstPrompt = data.prompts[0];
      expect(firstPrompt.llmIntegrationName).toBe("OpenAI Production");
      expect(firstPrompt).not.toHaveProperty("llmIntegrationId");
      expect(firstPrompt).not.toHaveProperty("llmIntegration");
    });

    it("sets llmIntegrationName to null when prompt has no integration", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      const secondPrompt = data.prompts[1];
      expect(secondPrompt.llmIntegrationName).toBeNull();
    });

    it("includes modelOverride in each prompt", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.prompts[0].modelOverride).toBe("gpt-4o-mini");
      expect(data.prompts[1].modelOverride).toBeNull();
    });

    it("includes all core prompt fields in export", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      const prompt = data.prompts[0];
      expect(prompt.feature).toBe("test_case_generation");
      expect(prompt.systemPrompt).toBe("You are a test case generator.");
      expect(prompt.userPrompt).toBe("Generate test cases for: {input}");
      expect(prompt.temperature).toBe(0.7);
      expect(prompt.maxOutputTokens).toBe(2048);
    });

    it("queries prisma with correct include for llmIntegration name", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockResolvedValue(mockPromptConfig);

      const request = createMockRequest({ id: "config-1" });
      await GET(request);

      expect(prisma.promptConfig.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "config-1" },
          include: expect.objectContaining({
            prompts: expect.objectContaining({
              include: expect.objectContaining({
                llmIntegration: expect.objectContaining({
                  select: expect.objectContaining({ name: true }),
                }),
              }),
            }),
          }),
        })
      );
    });

    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.promptConfig.findUnique as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ id: "config-1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to export");
    });
  });
});
