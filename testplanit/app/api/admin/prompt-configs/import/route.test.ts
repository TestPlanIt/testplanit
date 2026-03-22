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
    llmIntegration: {
      findMany: vi.fn(),
    },
    promptConfig: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

import { POST } from "./route";

const createMockRequest = (body: any): NextRequest => {
  return {
    json: async () => body,
  } as unknown as NextRequest;
};

const validImportBody = {
  name: "Imported Config",
  description: "Imported from staging",
  isDefault: false,
  isActive: true,
  prompts: [
    {
      feature: "test_case_generation",
      systemPrompt: "You are a test case generator.",
      userPrompt: "Generate test cases for: {input}",
      temperature: 0.7,
      maxOutputTokens: 2048,
      llmIntegrationName: "OpenAI Production",
      modelOverride: "gpt-4o-mini",
    },
    {
      feature: "markdown_parsing",
      systemPrompt: "You parse markdown.",
      userPrompt: "Parse: {input}",
      temperature: 0.3,
      maxOutputTokens: 1024,
      llmIntegrationName: null,
      modelOverride: null,
    },
  ],
};

const mockIntegrations = [
  { id: 1, name: "OpenAI Production" },
  { id: 2, name: "Azure OpenAI" },
];

const mockCreatedConfig = {
  id: "new-config-id",
  name: "Imported Config",
};

describe("POST /api/admin/prompt-configs/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated (no session)", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
      });

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });
  });

  describe("Validation", () => {
    it("returns 400 when name is missing", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const body = { ...validImportBody };
      delete (body as any).name;

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("name");
    });

    it("returns 400 when name is empty string", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const request = createMockRequest({ ...validImportBody, name: "" });
      const response = await POST(request);
      await response.json();

      expect(response.status).toBe(400);
    });

    it("returns 400 when prompts array is missing", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const body = { name: "Test Config" };
      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("prompts");
    });
  });

  describe("POST - import prompt config", () => {
    it("returns 201 with created config ID on success", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.id).toBe("new-config-id");
      expect(data.name).toBe("Imported Config");
    });

    it("resolves llmIntegrationName to llmIntegrationId by name lookup", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      await POST(request);

      expect(prisma.promptConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prompts: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  feature: "test_case_generation",
                  llmIntegrationId: 1,
                  modelOverride: "gpt-4o-mini",
                }),
              ]),
            }),
          }),
        })
      );
    });

    it("sets llmIntegrationId to null when llmIntegrationName is null", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      await POST(request);

      expect(prisma.promptConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prompts: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  feature: "markdown_parsing",
                  llmIntegrationId: null,
                }),
              ]),
            }),
          }),
        })
      );
    });

    it("gracefully sets llmIntegrationId to null when integration name not found", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue([]);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      await response.json();

      expect(response.status).toBe(201);
      expect(prisma.promptConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prompts: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  feature: "test_case_generation",
                  llmIntegrationId: null,
                }),
              ]),
            }),
          }),
        })
      );
    });

    it("reports unresolved integration names in response", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue([]);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.unresolvedIntegrations).toContain("OpenAI Production");
    });

    it("does not report null integration names as unresolved", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue([]);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      // null llmIntegrationName should not appear as unresolved
      expect(data.unresolvedIntegrations).not.toContain(null);
      expect(data.unresolvedIntegrations).not.toContain("null");
    });

    it("preserves modelOverride as-is from import JSON", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      await POST(request);

      expect(prisma.promptConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prompts: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  modelOverride: "gpt-4o-mini",
                }),
              ]),
            }),
          }),
        })
      );
    });

    it("fetches active integrations to build the name-to-id map", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      await POST(request);

      expect(prisma.llmIntegration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
            status: "ACTIVE",
          }),
          select: expect.objectContaining({
            id: true,
            name: true,
          }),
        })
      );
    });

    it("returns 500 when database create fails", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to import");
    });

    it("returns empty unresolvedIntegrations array when all integrations are found", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.llmIntegration.findMany as any).mockResolvedValue(mockIntegrations);
      (prisma.promptConfig.create as any).mockResolvedValue(mockCreatedConfig);

      const request = createMockRequest(validImportBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.unresolvedIntegrations).toEqual([]);
    });
  });
});
