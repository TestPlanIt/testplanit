import { LLM_FEATURES } from "@/lib/llm/constants";
import { integrationManager } from "@/lib/integrations";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "@/lib/llm/types";
import { baseDb } from "@/lib/db";
import {
  FORGE_CORS_HEADERS,
  forgeUserHasProjectAccess,
  verifyForgeStreamToken,
} from "@/lib/services/forge-jira-auth";
import {
  loadTemplateData,
  templateBelongsToProject,
} from "@/lib/services/jira-panel-generation";
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractStreamedTestCases,
  fetchExistingCasesContext,
  fetchLinkedIssuesContext,
  type GenerationContext,
  type IssueData,
} from "@/api/llm/generate-test-cases/shared";
import { NextRequest, NextResponse } from "next/server";

/**
 * Token-authenticated streaming generation for the Jira panel. The browser
 * calls this directly (bypassing Forge's 25s function limit). Auth is the
 * short-lived token minted by `generate-token` (bound to user/integration/
 * project/issue). Cases are parsed server-side and streamed as `case` SSE
 * events so the panel doesn't need any JSON-extraction logic.
 */
export async function POST(req: NextRequest) {
  const payload = verifyForgeStreamToken(req.headers.get("X-Forge-Token"));
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers: FORGE_CORS_HEADERS }
    );
  }

  const user = await baseDb.user.findFirst({
    where: { id: payload.userId, isActive: true, isDeleted: false },
    select: { id: true, name: true, email: true, access: true },
  });
  if (!user || !(await forgeUserHasProjectAccess(user, payload.projectId))) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403, headers: FORGE_CORS_HEADERS }
    );
  }

  let body: {
    templateId?: number;
    quantity?: string;
    autoGenerateTags?: boolean;
    userNotes?: string;
    folderId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const { templateId, quantity, autoGenerateTags, userNotes, folderId } = body;
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const { projectId, integrationId, issueKey, issueId } = payload;
  const encoder = new TextEncoder();
  let controllerClosed = false;

  const send = (
    controller: ReadableStreamDefaultController,
    data: object
  ): void => {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      controllerClosed = true;
    }
  };
  const keepAlive = (controller: ReadableStreamDefaultController): void => {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      controllerClosed = true;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      try {
        keepAlive(controller);

        if (!(await templateBelongsToProject(templateId, projectId))) {
          send(controller, {
            type: "error",
            message: "Template is not available for this project",
          });
          return;
        }
        const loaded = await loadTemplateData(templateId);
        if (!loaded) {
          send(controller, { type: "error", message: "Template not found" });
          return;
        }
        const template = loaded.template;

        send(controller, { type: "stage", stage: "resolving" });

        const manager = LlmManager.getInstance(baseDb);
        const resolver = new PromptResolver(baseDb);
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

        // Fetch the issue (title/description/status/priority + comments) via
        // the integration's own credentials.
        const adapter = await integrationManager.getAdapter(
          String(integrationId)
        );
        if (!adapter) {
          send(controller, {
            type: "error",
            message: "Jira integration is not available",
          });
          return;
        }
        const lookupId = issueId || issueKey || "";
        let issue: IssueData;
        try {
          const adapterIssue = await adapter.getIssue(lookupId);
          const comments = adapter.getIssueComments
            ? await adapter.getIssueComments(lookupId).catch(() => [])
            : [];
          issue = {
            key: issueKey || adapterIssue.key || lookupId,
            title: adapterIssue.title,
            description:
              typeof adapterIssue.description === "string"
                ? adapterIssue.description
                : undefined,
            status: adapterIssue.status,
            priority: adapterIssue.priority,
            comments,
          };
        } catch (err) {
          send(controller, {
            type: "error",
            message: `Could not load the Jira issue: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          });
          return;
        }

        // Build prompts + token budget (mirrors the sync generation core).
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
          { folderContext: folderId ?? 0 },
          quantity,
          autoGenerateTags,
          systemPromptBase,
          false
        );

        let maxTokensPerRequest = 4096;
        let maxTokens = resolvedPrompt.maxOutputTokens ?? 4096;
        const providerConfig = await (
          baseDb as any
        ).llmProviderConfig.findFirst({
          where: { llmIntegrationId: resolved.integrationId },
        });
        if (providerConfig) {
          maxTokensPerRequest = providerConfig.maxTokensPerRequest ?? 4096;
          maxTokens =
            providerConfig.defaultMaxTokens ??
            resolvedPrompt.maxOutputTokens ??
            4096;
        }

        const CONTENT_BUDGET_RATIO = 0.65;
        const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
        const contentBudget =
          Math.floor(maxTokensPerRequest * CONTENT_BUDGET_RATIO) -
          systemPromptTokens;

        const baseContext: GenerationContext = {
          folderContext: folderId ?? 0,
          ...(userNotes ? { userNotes } : {}),
        };
        // Baseline prompt size with no additive context (folder cases / linked
        // issues), to measure how much budget the extras can consume.
        const baseUserPrompt = buildUserPrompt(
          issue,
          { ...baseContext, existingTestCases: [], linkedIssues: [] },
          userPromptBase
        );
        const remainingBudget = Math.max(
          0,
          contentBudget - Math.ceil(baseUserPrompt.length / 4)
        );

        // Parity with the in-app streaming path: linked issues take budget
        // first (higher priority), folder-hierarchy cases get the remainder.
        const linkedResult =
          remainingBudget > 0 && adapter.getLinkedIssues && issue.key
            ? await fetchLinkedIssuesContext(
                adapter,
                issue.key,
                remainingBudget
              )
            : {
                included: [] as Awaited<
                  ReturnType<typeof fetchLinkedIssuesContext>
                >["included"],
                dropped: [],
                tokensUsed: 0,
              };

        const caseContextBudget = Math.max(
          0,
          remainingBudget - linkedResult.tokensUsed
        );
        const existingCases =
          caseContextBudget > 0
            ? await fetchExistingCasesContext(
                baseDb,
                projectId,
                {
                  folderId: folderId ?? 0,
                  issueRef: { issueKey, externalId: issueId, integrationId },
                },
                caseContextBudget
              )
            : [];

        const enrichedContext: GenerationContext = {
          ...baseContext,
          existingTestCases: existingCases,
          linkedIssues: linkedResult.included,
        };
        let userPrompt = buildUserPrompt(
          issue,
          enrichedContext,
          userPromptBase
        );

        // Final-safety-net comment truncation if still over budget.
        if (
          Math.ceil(userPrompt.length / 4) > contentBudget &&
          issue.comments &&
          issue.comments.length > 0
        ) {
          let comments = [...issue.comments];
          while (comments.length > 0) {
            comments = comments.slice(0, -1);
            const truncated = { ...issue, comments };
            userPrompt = buildUserPrompt(
              truncated,
              enrichedContext,
              userPromptBase
            );
            if (Math.ceil(userPrompt.length / 4) <= contentBudget) break;
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
          userId: user.id,
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
        let yielded = 0;
        let finishReason: string | undefined;
        try {
          for await (const chunk of manager.chatStream(
            resolved.integrationId,
            llmRequest
          )) {
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.delta) {
              accumulated += chunk.delta;
              const newCases = extractStreamedTestCases(
                accumulated,
                template,
                yielded
              );
              for (const tc of newCases) {
                send(controller, { type: "case", testCase: tc });
                yielded++;
              }
            }
          }
        } catch (err) {
          send(controller, {
            type: "error",
            message:
              err instanceof Error ? err.message : "AI generation failed",
          });
          return;
        }

        if (yielded === 0) {
          send(controller, {
            type: "error",
            message:
              finishReason === "length"
                ? "The response was truncated before any test case completed. Try fewer cases."
                : "No valid test cases were generated.",
          });
          return;
        }

        send(controller, {
          type: "done",
          count: yielded,
          finishReason,
          issue: { key: issue.key, title: issue.title },
        });
      } catch (err) {
        send(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "Internal server error",
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
      ...FORGE_CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}
