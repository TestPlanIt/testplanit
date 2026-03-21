import type { PrismaClient } from "@prisma/client";
import type { LlmFeature } from "../constants";
import { FALLBACK_PROMPTS, type FallbackPrompt } from "./fallback-prompts";

export interface ResolvedPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  source: "project" | "default" | "fallback";
  promptConfigId?: string;
  promptConfigName?: string;
  llmIntegrationId?: number;
  modelOverride?: string;
}

/**
 * Resolves the prompt configuration for a given feature and optional project.
 *
 * Resolution chain:
 * 1. Project-specific: If the project has a promptConfigId, use that config's prompt for the feature
 * 2. System default: Use the PromptConfig where isDefault=true
 * 3. Hard-coded fallback: Use the original hard-coded prompt (safety net)
 */
export class PromptResolver {
  constructor(private prisma: PrismaClient) {}

  async resolve(
    feature: LlmFeature,
    projectId?: number
  ): Promise<ResolvedPrompt> {
    // 1. Project-specific config
    if (projectId) {
      const project = await this.prisma.projects.findUnique({
        where: { id: projectId },
        select: { promptConfigId: true },
      });

      if (project?.promptConfigId) {
        const prompt = await this.prisma.promptConfigPrompt.findUnique({
          where: {
            promptConfigId_feature: {
              promptConfigId: project.promptConfigId,
              feature,
            },
          },
          include: {
            promptConfig: {
              select: { id: true, name: true },
            },
          },
        });

        if (prompt) {
          return {
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
            source: "project",
            promptConfigId: prompt.promptConfig.id,
            promptConfigName: prompt.promptConfig.name,
            llmIntegrationId: prompt.llmIntegrationId ?? undefined,
            modelOverride: prompt.modelOverride ?? undefined,
          };
        }
      }
    }

    // 2. System default
    const defaultConfig = await this.prisma.promptConfig.findFirst({
      where: { isDefault: true, isActive: true, isDeleted: false },
    });

    if (defaultConfig) {
      const prompt = await this.prisma.promptConfigPrompt.findUnique({
        where: {
          promptConfigId_feature: {
            promptConfigId: defaultConfig.id,
            feature,
          },
        },
      });

      if (prompt) {
        return {
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          temperature: prompt.temperature,
          maxOutputTokens: prompt.maxOutputTokens,
          source: "default",
          promptConfigId: defaultConfig.id,
          promptConfigName: defaultConfig.name,
          llmIntegrationId: prompt.llmIntegrationId ?? undefined,
          modelOverride: prompt.modelOverride ?? undefined,
        };
      }
    }

    // 3. Hard-coded fallback
    const fallback: FallbackPrompt = FALLBACK_PROMPTS[feature];
    return {
      systemPrompt: fallback.systemPrompt,
      userPrompt: fallback.userPrompt,
      temperature: fallback.temperature,
      maxOutputTokens: fallback.maxOutputTokens,
      source: "fallback",
    };
  }
}
