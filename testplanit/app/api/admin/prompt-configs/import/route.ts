import { prisma } from "~/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { z } from "zod";

const ImportSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  prompts: z.array(
    z.object({
      feature: z.string(),
      systemPrompt: z.string(),
      userPrompt: z.string(),
      temperature: z.number(),
      maxOutputTokens: z.number(),
      llmIntegrationName: z.string().nullable().optional(),
      modelOverride: z.string().nullable().optional(),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = ImportSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const missingFields = issues.map((i) => i.path.join(".")).join(", ");
      return NextResponse.json(
        { error: `Invalid import data. Issues with: ${missingFields || "name, prompts"}` },
        { status: 400 }
      );
    }

    const { name, description, isDefault, isActive, prompts } = parsed.data;

    // Fetch all active integrations to resolve names to IDs
    const activeIntegrations = await prisma.llmIntegration.findMany({
      where: { isDeleted: false, status: "ACTIVE" },
      select: { id: true, name: true },
    });

    // Build name-to-id map
    const nameToIdMap = new Map<string, number>();
    for (const integration of activeIntegrations) {
      nameToIdMap.set(integration.name, integration.id);
    }

    // Resolve integrations and track unresolved names
    const unresolvedIntegrations: string[] = [];
    const resolvedPrompts = prompts.map((prompt) => {
      let llmIntegrationId: number | null = null;

      if (prompt.llmIntegrationName) {
        const resolvedId = nameToIdMap.get(prompt.llmIntegrationName);
        if (resolvedId !== undefined) {
          llmIntegrationId = resolvedId;
        } else {
          // Graceful degradation: name not found, set to null
          if (!unresolvedIntegrations.includes(prompt.llmIntegrationName)) {
            unresolvedIntegrations.push(prompt.llmIntegrationName);
          }
        }
      }

      return {
        feature: prompt.feature,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxOutputTokens,
        llmIntegrationId,
        modelOverride: prompt.modelOverride ?? null,
      };
    });

    const created = await prisma.promptConfig.create({
      data: {
        name,
        description,
        isDefault: isDefault ?? false,
        isActive: isActive ?? true,
        prompts: {
          create: resolvedPrompts,
        },
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        unresolvedIntegrations,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error importing prompt config:", error);
    return NextResponse.json(
      { error: "Failed to import prompt config" },
      { status: 500 }
    );
  }
}
