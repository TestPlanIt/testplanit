import { LLM_FEATURES } from "@/lib/llm/constants";
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
  type GenerationContext,
  type IssueData,
  type TemplateData,
} from "../shared";

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return "AI generation failed";
  const parts: string[] = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  while (cause) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as { cause?: unknown }).cause;
    } else if (typeof cause === "object" && cause !== null && "code" in cause) {
      parts.push(String((cause as { code: unknown }).code));
      break;
    } else {
      break;
    }
  }
  return parts.filter(Boolean).join(": ");
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
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

  const encoder = new TextEncoder();
  let controllerClosed = false;

  function send(
    controller: ReadableStreamDefaultController,
    data: object
  ): void {
    if (controllerClosed) return;
    try {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
      );
    } catch {
      controllerClosed = true;
    }
  }

  function keepAlive(controller: ReadableStreamDefaultController): void {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      controllerClosed = true;
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      try {
        // Immediate keepalive so the proxy sees bytes right away
        keepAlive(controller);
        send(controller, { type: "stage", stage: "validating" });

        // Verify user has access to the project
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
                          some: { userId: session.user.id },
                        },
                      },
                      accessType: { not: ProjectAccessType.NO_ACCESS },
                    },
                  },
                },
                { defaultAccessType: ProjectAccessType.GLOBAL_ROLE },
                ...(isProjectAdmin
                  ? [
                      {
                        assignedUsers: {
                          some: { userId: session.user.id },
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
                  include: { llmProviderConfig: true },
                },
              },
            },
          },
        });

        if (!project) {
          send(controller, {
            type: "error",
            message: "Project not found or access denied",
          });
          return;
        }

        send(controller, { type: "stage", stage: "resolving" });

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
          send(controller, {
            type: "error",
            message: "No active LLM integration found for this project",
          });
          return;
        }

        // Build prompts
        const systemPromptBase =
          resolvedPrompt.source !== "fallback"
            ? resolvedPrompt.systemPrompt
            : undefined;
        const userPromptBase =
          resolvedPrompt.source !== "fallback"
            ? resolvedPrompt.userPrompt || undefined
            : undefined;

        const systemPrompt = buildSystemPrompt(
          template,
          context,
          quantity,
          autoGenerateTags,
          systemPromptBase
        );

        // TOKEN-02: Read provider config
        let maxTokensPerRequest = 4096;
        let maxTokens =
          resolvedPrompt.maxOutputTokens ?? 4096;

        const providerConfig = await (prisma as any).llmProviderConfig.findFirst(
          { where: { llmIntegrationId: resolved.integrationId } }
        );
        if (providerConfig) {
          maxTokensPerRequest =
            providerConfig.maxTokensPerRequest ?? 4096;
          maxTokens =
            providerConfig.defaultMaxTokens ??
            resolvedPrompt.maxOutputTokens ??
            4096;
        }

        // TOKEN-05: Calculate content budget
        const CONTENT_BUDGET_RATIO = 0.65;
        const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
        const contentBudget =
          Math.floor(maxTokensPerRequest * CONTENT_BUDGET_RATIO) -
          systemPromptTokens;

        // Build a base user prompt WITHOUT existing test cases to measure its size
        const contextWithoutCases: GenerationContext = {
          ...context,
          existingTestCases: [],
        };
        const baseUserPrompt = buildUserPrompt(issue, contextWithoutCases, userPromptBase);
        const basePromptTokens = Math.ceil(baseUserPrompt.length / 4);

        // Allocate remaining token budget to existing test case context
        const contextTokenBudget = Math.max(0, contentBudget - basePromptTokens);

        // Fetch prioritised context from folder hierarchy (server-side)
        const hierarchyContext = contextTokenBudget > 0
          ? await fetchHierarchyContext(prisma, projectId, context.folderContext, contextTokenBudget)
          : [];

        // Build the final context with server-fetched cases
        const enrichedContext: GenerationContext = {
          ...context,
          existingTestCases: hierarchyContext,
        };

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
              userPrompt = buildUserPrompt(
                truncatedIssue,
                enrichedContext,
                userPromptBase
              );
              estimatedUserTokens = Math.ceil(userPrompt.length / 4);
              if (estimatedUserTokens <= contentBudget) break;
            }
            wasTruncated = true;
          }
        }

        send(controller, { type: "stage", stage: "calling_ai" });

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
          timeout: 0,
          metadata: {
            projectId,
            issueKey: issue.key,
            templateId: template.id,
            timestamp: new Date().toISOString(),
          },
        };

        // Stream the LLM response
        let finishReason: string | undefined;
        try {
          for await (const chunk of manager.chatStream(
            resolved.integrationId,
            llmRequest
          )) {
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.delta) {
              send(controller, { type: "chunk", delta: chunk.delta });
            }
          }
        } catch (err) {
          console.error(
            "[generate-test-cases/stream] LLM stream failed:",
            err
          );
          send(controller, {
            type: "error",
            message: formatError(err),
          });
          return;
        }

        send(controller, {
          type: "done",
          finishReason,
          truncated: wasTruncated,
          metadata: {
            issueKey: issue.key,
            templateName: template.name,
          },
        });
      } catch (err) {
        console.error("[generate-test-cases/stream] Setup failed:", err);
        send(controller, {
          type: "error",
          message:
            err instanceof Error ? err.message : "Internal server error",
        });
      } finally {
        clearInterval(heartbeat);
        if (!controllerClosed) {
          controllerClosed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
