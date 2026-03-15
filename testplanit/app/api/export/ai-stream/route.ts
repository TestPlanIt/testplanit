import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import type { QuickScriptCaseData } from "~/app/actions/quickScriptActions";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { CodeContextService } from "~/lib/llm/services/code-context.service";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "~/lib/llm/types";
import { authOptions } from "~/server/auth";

interface SingleExportBody {
  mode: "single";
  caseId: number;
  projectId: number;
  templateId: number;
  caseData: QuickScriptCaseData;
}

interface BatchExportBody {
  mode: "batch";
  caseIds: number[];
  projectId: number;
  templateId: number;
  cases: QuickScriptCaseData[];
}

type ExportStreamBody = SingleExportBody | BatchExportBody;

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

  const body = (await req.json()) as ExportStreamBody;
  const { projectId, templateId } = body;

  // Load template
  const template = await prisma.caseExportTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Render Mustache header/footer/fallback up-front (needed for fallback events)
  const Mustache = (await import("mustache")).default;
  Mustache.escape = (text: string) =>
    String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  let mustacheFallback: string;
  let header: string;
  let footer: string;

  if (body.mode === "single") {
    header = template.headerBody
      ? Mustache.render(template.headerBody, body.caseData)
      : "";
    footer = template.footerBody
      ? Mustache.render(template.footerBody, body.caseData)
      : "";
    const bodyCode = Mustache.render(template.templateBody, body.caseData);
    mustacheFallback = [header, bodyCode, footer].filter(Boolean).join("\n\n");
  } else {
    header = template.headerBody
      ? Mustache.render(template.headerBody, body.cases[0])
      : "";
    footer = template.footerBody
      ? Mustache.render(template.footerBody, body.cases[0])
      : "";
    const bodies = body.cases.map((c) =>
      Mustache.render(template.templateBody, c)
    );
    mustacheFallback = [header, ...bodies, footer]
      .filter(Boolean)
      .join("\n\n");
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

  /** Send an SSE comment to keep the connection alive through reverse proxies. */
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
      // Send periodic keepalive comments so reverse proxies don't 504 us
      // while we resolve prompts, fetch code context, and wait for the
      // first LLM token (Gemini/Ollama can be slow).
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      try {
        // Send an immediate keepalive so the proxy sees bytes right away
        keepAlive(controller);

        // Get LLM integration
        const llmIntegration = await prisma.projectLlmIntegration.findFirst({
          where: { projectId, isActive: true },
          select: { llmIntegrationId: true },
        });

        if (!llmIntegration) {
          send(controller, {
            type: "fallback",
            code: mustacheFallback,
            error: "No active LLM integration",
          });
          return;
        }

        // Resolve prompt
        const resolver = new PromptResolver(prisma);
        const resolvedPrompt = await resolver.resolve(
          LLM_FEATURES.EXPORT_CODE_GENERATION,
          projectId
        );

        // Token budget
        // maxTokensPerRequest is the hard ceiling enforced by validateRequest() in the base
        // adapter — requests exceeding it throw before hitting the LLM API.
        // defaultMaxTokens is the fallback when a request doesn't specify maxTokens.
        const providerConfig = await prisma.llmProviderConfig.findFirst({
          where: { llmIntegrationId: llmIntegration.llmIntegrationId },
          select: { defaultMaxTokens: true, maxTokensPerRequest: true },
        });
        const maxContextTokens = providerConfig?.defaultMaxTokens || 8000;
        // Cap output tokens at the provider's hard ceiling so we never throw MAX_TOKENS_EXCEEDED.
        const outputTokenCap = providerConfig?.maxTokensPerRequest ?? Infinity;

        // Assemble code context if a repo is configured (optional)
        const repoConfig =
          await prisma.projectCodeRepositoryConfig.findUnique({
            where: { projectId },
            select: { id: true },
          });

        let contextResult = {
          context: "",
          filesUsed: [] as string[],
          tokenEstimate: 0,
          truncated: false,
        };

        if (repoConfig) {
          let relevanceHint: string;
          if (body.mode === "single") {
            relevanceHint = [
              body.caseData.name,
              ...body.caseData.steps.map(
                (s: any) => `${s.step} ${s.expectedResult}`
              ),
            ].join(" ");
          } else {
            relevanceHint = body.cases
              .flatMap((c) => [
                c.name,
                ...c.steps.map((s: any) => `${s.step} ${s.expectedResult}`),
              ])
              .join(" ");
          }

          contextResult = await CodeContextService.assembleContext(
            repoConfig.id,
            maxContextTokens,
            relevanceHint
          );
        }

        const noContextFallbackNote = `No repository context available. Generate test code using standard ${template.framework || "framework"} patterns and best practices.`;

        // Build system prompt
        let systemPrompt = resolvedPrompt.systemPrompt;
        systemPrompt = systemPrompt
          .replace(/\{\{FRAMEWORK\}\}/g, template.framework || "unknown")
          .replace(/\{\{LANGUAGE\}\}/g, template.language || "unknown");

        // Build user prompt
        let userPrompt: string;
        if (body.mode === "single") {
          const stepsText = body.caseData.steps
            .map(
              (s: any) =>
                `${s.order}. ${s.step}\n   Expected: ${s.expectedResult}`
            )
            .join("\n");
          userPrompt = resolvedPrompt.userPrompt
            .replace(/\{\{CASE_NAME\}\}/g, body.caseData.name)
            .replace(/\{\{STEPS_TEXT\}\}/g, stepsText)
            .replace(
              /\{\{CODE_CONTEXT\}\}/g,
              contextResult.context || noContextFallbackNote
            );
        } else {
          // Batch mode uses a hardcoded user prompt structure because the single-case
          // placeholders ({{CASE_NAME}}, {{STEPS_TEXT}}) don't map cleanly to multiple
          // cases. The system prompt and temperature from resolvedPrompt still apply.
          const casesText = body.cases
            .map((caseData, idx) => {
              const stepsText = caseData.steps
                .map(
                  (s: any) =>
                    `${s.order}. ${s.step}\n   Expected: ${s.expectedResult}`
                )
                .join("\n");
              return `--- Test Case ${idx + 1}: ${caseData.name} ---\n${stepsText}`;
            })
            .join("\n\n");
          const contextSection = contextResult.context
            ? `REPOSITORY CONTEXT:\n${contextResult.context}`
            : noContextFallbackNote;
          userPrompt = `Generate a single complete ${template.language || ""} test file that contains ALL ${body.cases.length} test cases below. Use a single set of imports at the top of the file — do not repeat imports between tests.\n\n${casesText}\n\n${contextSection}`;
        }

        if (header) {
          userPrompt += `\n\nDEFAULT HEADER (use as a starting point — extend or modify imports/setup as needed based on the repository context):\n\`\`\`\n${header}\n\`\`\``;
        }
        if (footer) {
          userPrompt += `\n\nDEFAULT FOOTER (use as a starting point — extend or modify teardown as needed):\n\`\`\`\n${footer}\n\`\`\``;
        }

        const llmManager = LlmManager.getInstance(prisma);
        const request: LlmRequest = {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: resolvedPrompt.temperature,
          maxTokens: Math.min(resolvedPrompt.maxOutputTokens, outputTokenCap),
          userId: session.user.id,
          projectId,
          feature: LLM_FEATURES.EXPORT_CODE_GENERATION,
          timeout: 0, // No timeout for streaming — allow the full response to arrive
        };

        try {
          let finishReason: string | undefined;
          for await (const chunk of llmManager.chatStream(
            llmIntegration.llmIntegrationId,
            request
          )) {
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.delta) send(controller, { type: "chunk", delta: chunk.delta });
          }
          send(controller, {
            type: "done",
            generatedBy: "ai",
            contextFiles: contextResult.filesUsed,
            finishReason,
          });
        } catch (err) {
          console.error("[export/ai-stream] LLM stream failed:", err);
          send(controller, {
            type: "fallback",
            code: mustacheFallback,
            error: formatError(err),
          });
        }
      } catch (err) {
        console.error("[export/ai-stream] Setup failed:", err);
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
      "Connection": "keep-alive",
    },
  });
}
