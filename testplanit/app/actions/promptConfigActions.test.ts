import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";
import { createPromptConfig, updatePromptConfig } from "./promptConfigActions";

vi.mock("~/lib/db", () => ({
  baseDb: {
    $transaction: vi.fn(),
    promptConfig: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    promptConfigPrompt: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

const mockPrompts = {
  markdown_parsing: {
    systemPrompt: "Parse markdown content",
    userPrompt: "Given the following markdown...",
    temperature: 0.7,
    maxOutputTokens: 2048,
    llmIntegrationId: null,
    modelOverride: null,
  },
  test_case_generation: {
    systemPrompt: "Generate test cases",
    userPrompt: "Based on the requirement...",
    temperature: 0.5,
    maxOutputTokens: 4096,
    llmIntegrationId: 1,
    modelOverride: "gpt-4",
  },
};

describe("promptConfigActions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("createPromptConfig", () => {
    it("should return error when user is not authenticated", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);

      const result = await createPromptConfig({
        name: "Test Config",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });

    it("should return error when user is not admin", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
        expires: new Date().toISOString(),
      } as any);

      const result = await createPromptConfig({
        name: "Test Config",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });

    it("should create prompt config with all prompts in a transaction", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockConfig = { id: "config-1", name: "Test Config" };
      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            create: vi.fn().mockResolvedValue(mockConfig),
            updateMany: vi.fn(),
          },
        };
        return fn(tx);
      });

      const result = await createPromptConfig({
        name: "Test Config",
        description: "A test config",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({ status: "success", id: "config-1" });
      expect(baseDb.$transaction).toHaveBeenCalledOnce();
    });

    it("should unset existing defaults when creating a new default config", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockUpdateMany = vi.fn();
      const mockCreate = vi
        .fn()
        .mockResolvedValue({ id: "config-2", name: "New Default" });

      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            create: mockCreate,
            updateMany: mockUpdateMany,
          },
        };
        return fn(tx);
      });

      const result = await createPromptConfig({
        name: "New Default",
        isDefault: true,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result.status).toBe("success");
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { isDefault: true, isDeleted: false },
        data: { isDefault: false },
      });
    });

    it("should not unset defaults when creating a non-default config", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockUpdateMany = vi.fn();
      const mockCreate = vi
        .fn()
        .mockResolvedValue({ id: "config-3", name: "Non-Default" });

      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            create: mockCreate,
            updateMany: mockUpdateMany,
          },
        };
        return fn(tx);
      });

      await createPromptConfig({
        name: "Non-Default",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it("should return error on database failure", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      vi.mocked(baseDb.$transaction).mockRejectedValue(
        new Error("Unique constraint violation")
      );

      const result = await createPromptConfig({
        name: "Duplicate Name",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Unique constraint violation",
      });
    });
  });

  describe("updatePromptConfig", () => {
    it("should return error when user is not authenticated", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);

      const result = await updatePromptConfig({
        id: "config-1",
        name: "Updated Config",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });

    it("should return error when user is not admin", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
        expires: new Date().toISOString(),
      } as any);

      const result = await updatePromptConfig({
        id: "config-1",
        name: "Updated Config",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Unauthorized",
      });
    });

    it("should update prompt config and upsert all prompts in a transaction", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockUpdate = vi.fn();
      const mockUpsert = vi.fn();

      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            update: mockUpdate,
            updateMany: vi.fn(),
          },
          promptConfigPrompt: {
            upsert: mockUpsert,
          },
        };
        return fn(tx);
      });

      const result = await updatePromptConfig({
        id: "config-1",
        name: "Updated Config",
        description: "Updated description",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({ status: "success", id: "config-1" });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "config-1" },
        data: {
          name: "Updated Config",
          description: "Updated description",
          isDefault: false,
          isActive: true,
        },
      });
      expect(mockUpsert).toHaveBeenCalledTimes(Object.keys(mockPrompts).length);
    });

    it("should unset other defaults when updating to default, excluding self", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockUpdateMany = vi.fn();

      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            update: vi.fn(),
            updateMany: mockUpdateMany,
          },
          promptConfigPrompt: {
            upsert: vi.fn(),
          },
        };
        return fn(tx);
      });

      await updatePromptConfig({
        id: "config-1",
        name: "New Default",
        isDefault: true,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { isDefault: true, isDeleted: false, id: { not: "config-1" } },
        data: { isDefault: false },
      });
    });

    it("should use upsert with composite key for prompt updates", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      const mockUpsert = vi.fn();

      vi.mocked(baseDb.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          promptConfig: {
            update: vi.fn(),
            updateMany: vi.fn(),
          },
          promptConfigPrompt: {
            upsert: mockUpsert,
          },
        };
        return fn(tx);
      });

      await updatePromptConfig({
        id: "config-1",
        name: "Test",
        isDefault: false,
        isActive: true,
        prompts: {
          test_case_generation: {
            systemPrompt: "Generate tests",
            userPrompt: "",
            temperature: 0.5,
            maxOutputTokens: 4096,
            llmIntegrationId: 1,
            modelOverride: "gpt-4",
          },
        },
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        where: {
          promptConfigId_feature: {
            promptConfigId: "config-1",
            feature: "test_case_generation",
          },
        },
        create: {
          promptConfigId: "config-1",
          feature: "test_case_generation",
          systemPrompt: "Generate tests",
          userPrompt: "",
          temperature: 0.5,
          maxOutputTokens: 4096,
          llmIntegrationId: 1,
          modelOverride: "gpt-4",
        },
        update: {
          systemPrompt: "Generate tests",
          userPrompt: "",
          temperature: 0.5,
          maxOutputTokens: 4096,
          llmIntegrationId: 1,
          modelOverride: "gpt-4",
        },
      });
    });

    it("should return error on database failure", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
        expires: new Date().toISOString(),
      } as any);

      vi.mocked(baseDb.$transaction).mockRejectedValue(
        new Error("Record not found")
      );

      const result = await updatePromptConfig({
        id: "nonexistent",
        name: "Test",
        isDefault: false,
        isActive: true,
        prompts: mockPrompts,
      });

      expect(result).toEqual({
        status: "error",
        message: "Record not found",
      });
    });
  });
});
