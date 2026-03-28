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
  buildSystemPrompt,
  buildUserPrompt,
  fetchHierarchyContext,
  parseAndValidateTestCases,
  type GenerationContext,
  type IssueData,
  type TemplateData,
} from "./shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, issue, template, context, quantity, autoGenerateTags } =
      body as {
        projectId: number;
        issue: IssueData;
        template: TemplateData;
        context: GenerationContext;
        quantity?: string;
        autoGenerateTags?: boolean;
      };

    if (!projectId || !issue || !template) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Verify user has access to the project and check for active LLM integration
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the where clause for project access
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            // Direct user permissions
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Group permissions
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Project default GLOBAL_ROLE (any authenticated user with a role)
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
            // Direct assignment to project with PROJECTADMIN access
            ...(isProjectAdmin
              ? [
                  {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
      include: {
        projectLlmIntegrations: {
          where: { isActive: true },
          include: {
            llmIntegration: {
              include: {
                llmProviderConfig: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    // Resolve prompt template from database (falls back to hard-coded default)
    const resolver = new PromptResolver(prisma);
    const resolvedPrompt = await resolver.resolve(
      LLM_FEATURES.TEST_CASE_GENERATION,
      projectId
    );

    // Resolve LLM integration via 3-tier chain
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

    // Build the prompts using resolved template as base (or fall back to hard-coded)
    const systemPromptBase = resolvedPrompt.source !== "fallback" ? resolvedPrompt.systemPrompt : undefined;
    const userPromptBase = resolvedPrompt.source !== "fallback" ? resolvedPrompt.userPrompt || undefined : undefined;

    const systemPrompt = buildSystemPrompt(
      template,
      context,
      quantity,
      autoGenerateTags,
      systemPromptBase
    );

    // TOKEN-02: Read provider config from the resolved integration (not projectLlmIntegrations[0])
    let maxTokensPerRequest = 4096;
    let maxTokens = resolvedPrompt.maxOutputTokens ?? 4096;

    const providerConfig = await (prisma as any).llmProviderConfig.findFirst({
      where: { llmIntegrationId: resolved.integrationId },
    });
    if (providerConfig) {
      maxTokensPerRequest = providerConfig.maxTokensPerRequest ?? 4096;
      maxTokens = providerConfig.defaultMaxTokens ?? resolvedPrompt.maxOutputTokens ?? 4096;
    }

    // TOKEN-05: Calculate content budget
    const CONTENT_BUDGET_RATIO = 0.65;
    const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
    const contentBudget = Math.floor(maxTokensPerRequest * CONTENT_BUDGET_RATIO) - systemPromptTokens;

    // Build a base user prompt WITHOUT existing test cases to measure its size
    const contextWithoutCases: GenerationContext = { ...context, existingTestCases: [] };
    const baseUserPrompt = buildUserPrompt(issue, contextWithoutCases, userPromptBase);
    const basePromptTokens = Math.ceil(baseUserPrompt.length / 4);

    // Allocate remaining token budget to existing test case context
    const contextTokenBudget = Math.max(0, contentBudget - basePromptTokens);

    // Fetch prioritised context from folder hierarchy (server-side)
    const hierarchyContext = contextTokenBudget > 0
      ? await fetchHierarchyContext(prisma, projectId, context.folderContext, contextTokenBudget)
      : [];

    const enrichedContext: GenerationContext = { ...context, existingTestCases: hierarchyContext };
    let userPrompt = buildUserPrompt(issue, enrichedContext, userPromptBase);
    let wasTruncated = false;

    // If still over budget (large issue comments), truncate comments
    let estimatedUserTokens = Math.ceil(userPrompt.length / 4);
    if (estimatedUserTokens > contentBudget) {
      const truncatedIssue = { ...issue };
      if (truncatedIssue.comments && truncatedIssue.comments.length > 0) {
        let comments = [...truncatedIssue.comments];
        while (comments.length > 0) {
          comments = comments.slice(0, -1);
          truncatedIssue.comments = comments;
          userPrompt = buildUserPrompt(truncatedIssue, enrichedContext, userPromptBase);
          estimatedUserTokens = Math.ceil(userPrompt.length / 4);
          if (estimatedUserTokens <= contentBudget) break;
        }
        wasTruncated = true;
      }
    }

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: resolvedPrompt.temperature,
      maxTokens, // from provider config defaultMaxTokens (TOKEN-02)
      userId: session.user.id,
      feature: "test_case_generation",
      ...(resolved.model ? { model: resolved.model } : {}),
      metadata: {
        projectId,
        issueKey: issue.key,
        templateId: template.id,
        timestamp: new Date().toISOString(),
      },
    };

    const { maxRetries, baseDelayMs } = SYNC_RETRY_PROFILE;
    const response = await manager.chat(
      resolved.integrationId,
      llmRequest,
      { maxRetries, baseDelayMs },
    );

    // RETRY-03: Check truncation BEFORE JSON parse
    if (response.finishReason === "length") {
      return NextResponse.json(
        {
          error: `Response was truncated (used ${response.totalTokens ?? 0}/${maxTokens} tokens). Try reducing input size or increasing token limit.`,
          truncated: true,
          tokens: {
            used: response.totalTokens ?? 0,
            limit: maxTokens,
            prompt: response.promptTokens ?? 0,
            completion: response.completionTokens ?? 0,
          },
        },
        { status: 422 },
      );
    }

    // Parse & validate the LLM response using shared logic
    const { testCases, parseError } = parseAndValidateTestCases(
      response.content,
      template,
      issue,
      autoGenerateTags,
      quantity,
    );

    if (parseError) {
      return NextResponse.json(
        {
          error: parseError.userError,
          suggestions: parseError.userSuggestions,
          details: parseError.errorMessage,
          responseLength: parseError.responseLength,
          context: {
            quantity: quantity || "several",
            fieldsCount: template.fields?.length || 0,
            autoTagsEnabled: !!autoGenerateTags,
            issueLength: issue.description?.length || 0,
          },
          technical: {
            parseError: parseError.errorMessage,
            responsePreview: parseError.responsePreview,
            seemsTruncated: parseError.seemsTruncated,
          },
        },
        { status: 500 }
      );
    }

    if (testCases.length === 0) {
      return NextResponse.json(
        {
          error: "No valid test cases generated",
          rawLlmResponse: response.content.substring(0, 2000),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      testCases,
      metadata: {
        issueKey: issue.key,
        templateName: template.name,
        generatedCount: testCases.length,
        model: response.model,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
        truncated: wasTruncated,
        ...(wasTruncated && {
          truncationNote: "Existing test cases and/or comments were trimmed to fit token budget",
        }),
      },
    });
  } catch (error) {
    console.error("Error in POST /api/llm/generate-test-cases:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate test cases";
    const errorStack = error instanceof Error ? error.stack : "";

    return NextResponse.json(
      {
        error: "Failed to generate test cases",
        details: errorMessage,
        stack: errorStack?.substring(0, 1000), // Include stack trace for debugging
      },
      { status: 500 }
    );
  }
}
