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
  buildExpandSystemPrompt,
  buildExpandUserPrompt,
  parseAndValidateTestCases,
  type GenerationContext,
  type IssueData,
  type TemplateData,
  type TestCaseOutline,
} from "../shared";
import {
  classifyLlmStreamError,
  type LlmStreamErrorCode,
} from "../error-codes";

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return "AI generation failed";
  const parts: string[] = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  while (cause) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as { cause?: unknown }).cause;
    } else if (typeof cause === "object" && "code" in cause) {
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
  const {
    projectId,
    issue,
    template,
    context,
    outline,
    autoGenerateTags,
    includeParameters,
  } = body as {
    projectId: number;
    issue: IssueData;
    template: TemplateData;
    context: GenerationContext;
    outline: TestCaseOutline;
    autoGenerateTags?: boolean;
    includeParameters?: boolean;
  };

  if (!projectId || !issue || !template || !outline) {
    return NextResponse.json(
      { error: "Missing required parameters", errorCode: "invalid_request" },
      { status: 400 }
    );
  }

  // Server-side admin gate on `includeParameters`. The wizard hides the
  // toggle for non-admins; a crafted request body must still be rejected
  // here. Returned as a plain JSON 403 (not via the SSE stream) so the
  // client sees a synchronous failure before the heartbeat starts.
  if (includeParameters === true && session.user.access !== "ADMIN") {
    return NextResponse.json(
      {
        error: "Admin access required for includeParameters",
        code: "FORBIDDEN_PARAMETER_GENERATION",
        errorCode: "forbidden",
      },
      { status: 403 }
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
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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
        keepAlive(controller);

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
          send(controller, {
            type: "error",
            code: "project_not_found" satisfies LlmStreamErrorCode,
            message: "Project not found or access denied",
          });
          return;
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
          send(controller, {
            type: "error",
            code: "no_integration" satisfies LlmStreamErrorCode,
            message: "No active LLM integration found for this project",
          });
          return;
        }

        const systemPromptBase =
          resolvedPrompt.source !== "fallback"
            ? resolvedPrompt.systemPrompt
            : undefined;
        const userPromptBase =
          resolvedPrompt.source !== "fallback"
            ? resolvedPrompt.userPrompt || undefined
            : undefined;

        const systemPrompt = buildExpandSystemPrompt(
          template,
          autoGenerateTags,
          systemPromptBase,
          includeParameters === true
        );
        const userPrompt = buildExpandUserPrompt(
          issue,
          outline,
          context,
          userPromptBase
        );

        let maxTokens = resolvedPrompt.maxOutputTokens ?? 4096;
        const providerConfig = await (
          prisma as any
        ).llmProviderConfig.findFirst({
          where: { llmIntegrationId: resolved.integrationId },
        });
        if (providerConfig) {
          maxTokens =
            providerConfig.defaultMaxTokens ??
            resolvedPrompt.maxOutputTokens ??
            4096;
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
          timeout: providerConfig?.timeout ?? 0,
          metadata: {
            projectId,
            issueKey: issue.key,
            templateId: template.id,
            timestamp: new Date().toISOString(),
          },
        };

        let accumulated = "";
        let finishReason: string | undefined;

        try {
          for await (const chunk of manager.chatStream(
            resolved.integrationId,
            llmRequest
          )) {
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.delta) {
              accumulated += chunk.delta;
              send(controller, { type: "chunk", delta: chunk.delta });
            }
          }
        } catch (err) {
          const message = formatError(err);
          send(controller, {
            type: "error",
            code: classifyLlmStreamError(message),
            message,
          });
          return;
        }

        const { testCases, parseError } = parseAndValidateTestCases(
          accumulated,
          template,
          issue,
          autoGenerateTags,
          "just_one"
        );

        if (parseError || testCases.length === 0) {
          if (parseError) {
            console.error("\n=== EXPAND PARSE ERROR ===");
            console.error("User error:", parseError.userError);
            console.error("Raw error:", parseError.errorMessage);
            console.error("Finish reason:", finishReason ?? "<none>");
            console.error("Response length:", parseError.responseLength);
            console.error("Seems truncated:", parseError.seemsTruncated);
            console.error("Response preview:", parseError.responsePreview);
          }
          send(controller, {
            type: "error",
            code: "generic" satisfies LlmStreamErrorCode,
            message: parseError?.userError ?? "No test case generated",
            details: parseError
              ? parseError.seemsTruncated
                ? `Response appears truncated${
                    finishReason === "length"
                      ? " (hit the max-tokens limit)"
                      : ""
                  } at ${parseError.responseLength} chars.`
                : `Parser error: ${parseError.errorMessage}`
              : "The model returned no test case content.",
            suggestions: parseError?.userSuggestions,
            finishReason,
            responsePreview: parseError?.responsePreview,
            responseLength: parseError?.responseLength,
            seemsTruncated: parseError?.seemsTruncated,
          });
          return;
        }

        send(controller, {
          type: "done",
          finishReason,
          testCase: { ...testCases[0], name: outline.title },
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Internal server error";
        send(controller, {
          type: "error",
          code: classifyLlmStreamError(message),
          message,
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
