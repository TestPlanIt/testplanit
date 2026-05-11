import { LLM_FEATURES, SYNC_RETRY_PROFILE } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "@/lib/llm/types";
import { prisma } from "@/lib/prisma";
import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import {
  buildOutlineSystemPrompt,
  buildOutlineUserPrompt,
  type GenerationContext,
  type IssueData,
  type TestCaseOutline,
} from "../shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, issue, context, quantity } = body as {
      projectId: number;
      issue: IssueData;
      context: GenerationContext;
      quantity?: string;
    };

    if (!projectId || !issue) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: { some: { userId: session.user.id } },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            { defaultAccessType: ProjectAccessType.GLOBAL_ROLE },
            ...(isProjectAdmin
              ? [{ assignedUsers: { some: { userId: session.user.id } } }]
              : []),
          ],
        };

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const manager = LlmManager.getInstance(prisma);
    const resolver = new PromptResolver(prisma);
    const resolvedPrompt = await resolver.resolve(
      LLM_FEATURES.TEST_CASE_GENERATION,
      projectId
    );

    const resolved = await manager.resolveIntegration(
      LLM_FEATURES.TEST_CASE_GENERATION,
      projectId,
      resolvedPrompt
    );
    if (!resolved) {
      return NextResponse.json(
        { error: "No active LLM integration found for this project" },
        { status: 400 }
      );
    }

    const systemPrompt = buildOutlineSystemPrompt(quantity);
    const userPrompt = buildOutlineUserPrompt(issue, context);

    let maxTokens = resolvedPrompt.maxOutputTokens ?? 1024;
    const providerConfig = await (prisma as any).llmProviderConfig.findFirst({
      where: { llmIntegrationId: resolved.integrationId },
    });
    if (providerConfig) {
      maxTokens = Math.min(providerConfig.defaultMaxTokens ?? 1024, 1024);
    }

    const llmRequest: LlmRequest = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: resolvedPrompt.temperature,
      maxTokens,
      userId: session.user.id,
      feature: "test_case_generation",
      ...(resolved.model ? { model: resolved.model } : {}),
      metadata: {
        projectId,
        issueKey: issue.key,
        timestamp: new Date().toISOString(),
      },
    };

    const { maxRetries, baseDelayMs } = SYNC_RETRY_PROFILE;
    const response = await manager.chat(resolved.integrationId, llmRequest, {
      maxRetries,
      baseDelayMs,
    });

    const raw = response.content.trim();
    let parsed: { outlines: TestCaseOutline[] };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse outline response from LLM" },
        { status: 500 }
      );
    }

    if (!Array.isArray(parsed.outlines) || parsed.outlines.length === 0) {
      return NextResponse.json(
        { error: "LLM returned no outlines" },
        { status: 500 }
      );
    }

    return NextResponse.json({ outlines: parsed.outlines });
  } catch (error) {
    console.error("Error in POST /api/llm/generate-test-cases/outline:", error);
    return NextResponse.json(
      {
        error: "Failed to generate outlines",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
