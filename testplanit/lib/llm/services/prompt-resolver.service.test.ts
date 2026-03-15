import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_FEATURES } from "../constants";
import { FALLBACK_PROMPTS } from "./fallback-prompts";
import { PromptResolver } from "./prompt-resolver.service";

/**
 * Creates a mock PrismaClient with the methods used by PromptResolver.
 */
function createMockPrisma() {
  return {
    projects: {
      findUnique: vi.fn(),
    },
    promptConfig: {
      findFirst: vi.fn(),
    },
    promptConfigPrompt: {
      findUnique: vi.fn(),
    },
  } as any;
}

describe("PromptResolver", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let resolver: PromptResolver;

  const projectPrompt = {
    systemPrompt: "Project system prompt",
    userPrompt: "Project user prompt",
    temperature: 0.5,
    maxOutputTokens: 4096,
    promptConfig: { id: "project-config-id", name: "Project Config" },
  };

  const defaultPrompt = {
    systemPrompt: "Default system prompt",
    userPrompt: "Default user prompt",
    temperature: 0.7,
    maxOutputTokens: 2048,
  };

  const defaultConfig = {
    id: "default-config-id",
    name: "System Default",
    isDefault: true,
    isActive: true,
    isDeleted: false,
  };

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    resolver = new PromptResolver(mockPrisma);
  });

  describe("Resolution chain", () => {
    it("returns project-specific prompt when project has a config assigned", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: "project-config-id",
      });
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(
        projectPrompt
      );

      const result = await resolver.resolve(
        LLM_FEATURES.TEST_CASE_GENERATION,
        1
      );

      expect(result.source).toBe("project");
      expect(result.systemPrompt).toBe("Project system prompt");
      expect(result.userPrompt).toBe("Project user prompt");
      expect(result.temperature).toBe(0.5);
      expect(result.maxOutputTokens).toBe(4096);
      expect(result.promptConfigId).toBe("project-config-id");
      expect(result.promptConfigName).toBe("Project Config");
    });

    it("falls back to system default when project has no config", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: null,
      });
      mockPrisma.promptConfig.findFirst.mockResolvedValue(defaultConfig);
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(defaultPrompt);

      const result = await resolver.resolve(
        LLM_FEATURES.TEST_CASE_GENERATION,
        1
      );

      expect(result.source).toBe("default");
      expect(result.systemPrompt).toBe("Default system prompt");
      expect(result.promptConfigId).toBe("default-config-id");
      expect(result.promptConfigName).toBe("System Default");
    });

    it("falls back to system default when no projectId is provided", async () => {
      mockPrisma.promptConfig.findFirst.mockResolvedValue(defaultConfig);
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(defaultPrompt);

      const result = await resolver.resolve(
        LLM_FEATURES.TEST_CASE_GENERATION
      );

      expect(result.source).toBe("default");
      expect(mockPrisma.projects.findUnique).not.toHaveBeenCalled();
    });

    it("falls back to hard-coded fallback when no database configs exist", async () => {
      mockPrisma.promptConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve(
        LLM_FEATURES.TEST_CASE_GENERATION
      );

      const fallback = FALLBACK_PROMPTS[LLM_FEATURES.TEST_CASE_GENERATION];
      expect(result.source).toBe("fallback");
      expect(result.systemPrompt).toBe(fallback.systemPrompt);
      expect(result.userPrompt).toBe(fallback.userPrompt);
      expect(result.temperature).toBe(fallback.temperature);
      expect(result.maxOutputTokens).toBe(fallback.maxOutputTokens);
      expect(result.promptConfigId).toBeUndefined();
      expect(result.promptConfigName).toBeUndefined();
    });
  });

  describe("Edge cases", () => {
    it("falls through project config to default when project config has no prompt for feature", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: "project-config-id",
      });
      // Project config exists but has no prompt for this feature
      mockPrisma.promptConfigPrompt.findUnique
        .mockResolvedValueOnce(null) // project config lookup
        .mockResolvedValueOnce(defaultPrompt); // default config lookup
      mockPrisma.promptConfig.findFirst.mockResolvedValue(defaultConfig);

      const result = await resolver.resolve(
        LLM_FEATURES.EDITOR_ASSISTANT,
        1
      );

      expect(result.source).toBe("default");
    });

    it("falls through to fallback when default config has no prompt for feature", async () => {
      mockPrisma.promptConfig.findFirst.mockResolvedValue(defaultConfig);
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(null);

      const result = await resolver.resolve(LLM_FEATURES.LLM_TEST);

      expect(result.source).toBe("fallback");
    });

    it("falls through project to fallback when project has no config and no default exists", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: null,
      });
      mockPrisma.promptConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve(
        LLM_FEATURES.MAGIC_SELECT_CASES,
        1
      );

      expect(result.source).toBe("fallback");
    });

    it("skips project lookup when project does not exist", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue(null);
      mockPrisma.promptConfig.findFirst.mockResolvedValue(defaultConfig);
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(defaultPrompt);

      const result = await resolver.resolve(
        LLM_FEATURES.MARKDOWN_PARSING,
        999
      );

      expect(result.source).toBe("default");
    });
  });

  describe("Prisma queries", () => {
    it("queries project with correct where clause", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: null,
      });
      mockPrisma.promptConfig.findFirst.mockResolvedValue(null);

      await resolver.resolve(LLM_FEATURES.TEST_CASE_GENERATION, 42);

      expect(mockPrisma.projects.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: { promptConfigId: true },
      });
    });

    it("queries default config with correct filters", async () => {
      mockPrisma.promptConfig.findFirst.mockResolvedValue(null);

      await resolver.resolve(LLM_FEATURES.TEST_CASE_GENERATION);

      expect(mockPrisma.promptConfig.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true, isActive: true, isDeleted: false },
      });
    });

    it("queries prompt with compound unique key", async () => {
      mockPrisma.projects.findUnique.mockResolvedValue({
        promptConfigId: "cfg-123",
      });
      mockPrisma.promptConfigPrompt.findUnique.mockResolvedValue(
        projectPrompt
      );

      await resolver.resolve(LLM_FEATURES.EDITOR_ASSISTANT, 1);

      expect(mockPrisma.promptConfigPrompt.findUnique).toHaveBeenCalledWith({
        where: {
          promptConfigId_feature: {
            promptConfigId: "cfg-123",
            feature: LLM_FEATURES.EDITOR_ASSISTANT,
          },
        },
        include: {
          promptConfig: {
            select: { id: true, name: true },
          },
        },
      });
    });
  });

  describe("All features have fallback prompts", () => {
    for (const feature of Object.values(LLM_FEATURES)) {
      it(`has a fallback prompt for "${feature}"`, async () => {
        mockPrisma.promptConfig.findFirst.mockResolvedValue(null);

        const result = await resolver.resolve(feature);

        expect(result.source).toBe("fallback");
        expect(result.systemPrompt).toBeTruthy();
        expect(result.userPrompt).toBeDefined();
        expect(result.temperature).toBeGreaterThanOrEqual(0);
        expect(result.maxOutputTokens).toBeGreaterThan(0);
      });
    }
  });
});
