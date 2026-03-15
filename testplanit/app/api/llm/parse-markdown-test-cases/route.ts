import { LLM_FEATURES } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "@/lib/llm/types";
import { prisma } from "@/lib/prisma";
import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

interface ParsedStep {
  action: string;
  expectedResult?: string;
}

interface ParsedTestCase {
  name: string;
  description?: string;
  steps?: ParsedStep[];
  preconditions?: string;
  tags?: string[];
  [key: string]: any;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, markdown } = body as {
      projectId: number;
      markdown: string;
    };

    if (!projectId || !markdown) {
      return NextResponse.json(
        { error: "Missing required parameters (projectId, markdown)" },
        { status: 400 }
      );
    }

    // Verify user has access to the project and check for active LLM integration
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
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
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

    const activeLlmIntegration = project.projectLlmIntegrations[0];
    if (!activeLlmIntegration) {
      return NextResponse.json(
        { error: "No active LLM integration found for this project" },
        { status: 400 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    // Resolve prompt from database (falls back to hard-coded default)
    const resolver = new PromptResolver(prisma);
    const resolvedPrompt = await resolver.resolve(
      LLM_FEATURES.MARKDOWN_PARSING,
      projectId
    );

    const configuredMaxTokens =
      activeLlmIntegration.llmIntegration.llmProviderConfig?.defaultMaxTokens ||
      resolvedPrompt.maxOutputTokens;
    const maxTokens = Math.max(configuredMaxTokens, 4000);

    const llmRequest: LlmRequest = {
      messages: [
        { role: "system", content: resolvedPrompt.systemPrompt },
        {
          role: "user",
          content: `Parse the following markdown document and extract all test cases:\n\n${markdown}`,
        },
      ],
      temperature: resolvedPrompt.temperature,
      maxTokens,
      userId: session.user.id,
      feature: "markdown_test_case_parsing",
      metadata: {
        projectId,
        markdownLength: markdown.length,
        timestamp: new Date().toISOString(),
      },
    };

    const response = await manager.chat(
      activeLlmIntegration.llmIntegrationId,
      llmRequest
    );

    // Parse the LLM response
    let parsedResponse: { testCases: ParsedTestCase[] } = { testCases: [] };
    try {
      const cleanContent = response.content.trim();

      // Try to extract JSON from various formats
      let jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        // Try to find JSON between code blocks
        const codeBlockMatch = cleanContent.match(
          /```(?:json)?\s*(\{[\s\S]*?\})[\s\S]*?```/
        );
        if (codeBlockMatch) {
          jsonMatch = [codeBlockMatch[1]];
        } else {
          // Try incomplete JSON
          const incompleteMatch = cleanContent.match(/\{[\s\S]*$/);
          if (incompleteMatch) {
            let incompleteJson = incompleteMatch[0];

            // Close open brackets and braces
            const openBrackets = (incompleteJson.match(/\[/g) || []).length;
            const closeBrackets = (incompleteJson.match(/\]/g) || []).length;
            if (openBrackets > closeBrackets) {
              incompleteJson += "]".repeat(openBrackets - closeBrackets);
            }

            const openBraces = (incompleteJson.match(/\{/g) || []).length;
            const closeBraces = (incompleteJson.match(/\}/g) || []).length;
            if (openBraces > closeBraces) {
              incompleteJson += "}".repeat(openBraces - closeBraces);
            }

            jsonMatch = [incompleteJson];
          }
        }
      }

      if (jsonMatch) {
        const rawParsed = JSON.parse(jsonMatch[0]);

        if (rawParsed.testCases && Array.isArray(rawParsed.testCases)) {
          parsedResponse = rawParsed;
        } else if (Array.isArray(rawParsed)) {
          parsedResponse = { testCases: rawParsed as ParsedTestCase[] };
        } else {
          parsedResponse = { testCases: [rawParsed as ParsedTestCase] };
        }
      }
    } catch (parseError) {
      console.error("Failed to parse LLM markdown response:", parseError);
      return NextResponse.json(
        {
          error: "Failed to parse AI response",
          details:
            parseError instanceof Error ? parseError.message : String(parseError),
        },
        { status: 500 }
      );
    }

    // Validate and sanitize
    const testCases = (parsedResponse.testCases || [])
      .map((tc, index) => ({
        name: tc.name || `Test Case ${index + 1}`,
        description: tc.description,
        preconditions: tc.preconditions,
        steps: Array.isArray(tc.steps)
          ? tc.steps
              .filter((s) => s && typeof s.action === "string")
              .map((s) => ({
                action: s.action,
                expectedResult: s.expectedResult,
              }))
          : [],
        tags: Array.isArray(tc.tags)
          ? tc.tags.filter((t) => typeof t === "string" && t.trim().length > 0)
          : [],
        // Preserve any custom fields
        ...Object.fromEntries(
          Object.entries(tc).filter(
            ([key]) =>
              !["name", "description", "preconditions", "steps", "tags"].includes(
                key
              )
          )
        ),
      }))
      .filter((tc) => tc.name); // Filter out cases without names

    if (testCases.length === 0) {
      return NextResponse.json(
        { error: "No valid test cases could be extracted from the markdown" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      testCases,
      metadata: {
        parsedCount: testCases.length,
        model: response.model,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
      },
    });
  } catch (error) {
    console.error("Error in POST /api/llm/parse-markdown-test-cases:", error);
    return NextResponse.json(
      {
        error: "Failed to parse markdown test cases",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
