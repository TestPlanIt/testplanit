"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";

interface PromptInput {
  id?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  llmIntegrationId?: number | null;
  modelOverride?: string | null;
}

interface CreatePromptConfigInput {
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  prompts: Record<string, PromptInput>;
}

interface UpdatePromptConfigInput {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  prompts: Record<string, PromptInput>;
}

interface ActionResult {
  status: "success" | "error";
  message?: string;
  id?: string;
}

export async function createPromptConfig(
  input: CreatePromptConfigInput
): Promise<ActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // If setting as default, unset existing defaults first
      if (input.isDefault) {
        await tx.promptConfig.updateMany({
          where: { isDefault: true, isDeleted: false },
          data: { isDefault: false },
        });
      }

      // Create the PromptConfig with all prompts in one transaction
      const config = await tx.promptConfig.create({
        data: {
          name: input.name,
          description: input.description || null,
          isDefault: input.isDefault,
          isActive: input.isActive,
          prompts: {
            create: Object.entries(input.prompts).map(([feature, prompt]) => ({
              feature,
              systemPrompt: prompt.systemPrompt,
              userPrompt: prompt.userPrompt || "",
              temperature: prompt.temperature,
              maxOutputTokens: prompt.maxOutputTokens,
              ...(prompt.llmIntegrationId
                ? { llmIntegrationId: prompt.llmIntegrationId }
                : {}),
              modelOverride: prompt.modelOverride || null,
            })),
          },
        },
      });

      return config;
    });

    return { status: "success", id: result.id };
  } catch (error: any) {
    console.error("Error creating prompt config:", error);
    const message = error?.message || "Failed to create prompt config";
    return { status: "error", message };
  }
}

export async function updatePromptConfig(
  input: UpdatePromptConfigInput
): Promise<ActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // If setting as default, unset existing defaults first
      if (input.isDefault) {
        await tx.promptConfig.updateMany({
          where: { isDefault: true, isDeleted: false, id: { not: input.id } },
          data: { isDefault: false },
        });
      }

      // Update the PromptConfig
      await tx.promptConfig.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description || null,
          isDefault: input.isDefault,
          isActive: input.isActive,
        },
      });

      // Upsert each PromptConfigPrompt
      for (const [feature, prompt] of Object.entries(input.prompts)) {
        await tx.promptConfigPrompt.upsert({
          where: {
            promptConfigId_feature: {
              promptConfigId: input.id,
              feature,
            },
          },
          create: {
            promptConfigId: input.id,
            feature,
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt || "",
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
            llmIntegrationId: prompt.llmIntegrationId || null,
            modelOverride: prompt.modelOverride || null,
          },
          update: {
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt || "",
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
            llmIntegrationId: prompt.llmIntegrationId || null,
            modelOverride: prompt.modelOverride || null,
          },
        });
      }
    });

    return { status: "success", id: input.id };
  } catch (error: any) {
    console.error("Error updating prompt config:", error);
    const message = error?.message || "Failed to update prompt config";
    return { status: "error", message };
  }
}
