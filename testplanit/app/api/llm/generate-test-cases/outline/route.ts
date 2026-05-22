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
    // The outline endpoint accepts `includeParameters` for uniform wizard
    // plumbing but ignores it — outlines are titles + summaries only.
    // The expand endpoint applies the flag.
    const { projectId, issue, context, quantity } = body as {
      projectId: number;
      issue: IssueData;
      context: GenerationContext;
      quantity?: string;
      includeParameters?: boolean;
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

    let maxTokens = resolvedPrompt.maxOutputTokens ?? 2048;
    const providerConfig = await (prisma as any).llmProviderConfig.findFirst({
      where: { llmIntegrationId: resolved.integrationId },
    });
    if (providerConfig) {
      maxTokens =
        providerConfig.defaultMaxTokens ??
        resolvedPrompt.maxOutputTokens ??
        2048;
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
    const finishReason = response.finishReason;
    let parsed: { outlines: TestCaseOutline[] };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      const errMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      const responseLength = raw.length;
      const responsePreview = raw.slice(0, 500);

      console.error("\n=== OUTLINE PARSE ERROR ===");
      console.error("Parse error:", errMsg);
      console.error("Finish reason:", finishReason ?? "<none>");
      console.error("Response length:", responseLength);
      console.error("Response preview:", responsePreview);

      const { code, details, suggestions } = classifyOutlineParseFailure({
        raw,
        finishReason,
        errMsg,
      });

      return NextResponse.json(
        {
          error: "Failed to parse outline response from LLM",
          code,
          details,
          suggestions,
          finishReason,
          responseLength,
          responsePreview,
        },
        { status: 500 }
      );
    }

    if (!Array.isArray(parsed.outlines) || parsed.outlines.length === 0) {
      console.error("\n=== OUTLINE EMPTY RESPONSE ===");
      console.error("Finish reason:", finishReason ?? "<none>");
      console.error("Parsed response:", JSON.stringify(parsed).slice(0, 500));
      return NextResponse.json(
        {
          error: "LLM returned no outlines",
          code: "generic",
          details:
            "The model returned valid JSON but the outlines array was empty.",
          suggestions: [
            "Try regenerating — this is often transient",
            "Refine the issue description or testing guidance",
            "Try a different model or temperature in LLM settings",
          ],
          finishReason,
        },
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

function classifyOutlineParseFailure(input: {
  raw: string;
  finishReason: string | undefined;
  errMsg: string;
}): { code: string; details: string; suggestions: string[] } {
  const { raw, finishReason, errMsg } = input;
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      code: "generic",
      details:
        "The model returned an empty response. This is usually transient or a connectivity issue with the provider.",
      suggestions: [
        "Try again — empty responses are typically transient",
        "Check the LLM integration's status page",
        "Verify the model and API key in LLM settings",
      ],
    };
  }

  if (
    finishReason === "length" ||
    errMsg.includes("Unexpected end") ||
    (!trimmed.endsWith("}") && !trimmed.endsWith("]"))
  ) {
    return {
      code: "generic",
      details: `The model's response was cut off before it finished${
        finishReason === "length" ? " (hit the max-tokens limit)" : ""
      }. The JSON was incomplete and could not be parsed.`,
      suggestions: [
        'Try a smaller quantity (e.g. "Few" instead of "Many")',
        "Shorten the issue description or testing guidance",
        "Raise the model's max-output-tokens in LLM settings",
      ],
    };
  }

  const refusalMarkers = [
    "i cannot",
    "i can't",
    "i am unable",
    "i'm unable",
    "i'm not able",
    "sorry,",
    "as an ai",
  ];
  const lower = trimmed.toLowerCase();
  if (refusalMarkers.some((m) => lower.includes(m)) && !lower.includes("{")) {
    return {
      code: "generic",
      details:
        "The model returned a refusal or explanatory text instead of JSON. The issue content may have triggered safety filters or the prompt may be unclear.",
      suggestions: [
        "Rephrase the issue description or testing guidance",
        "Try a different model — providers have different safety thresholds",
        "Remove any content that might look like instructions to the model",
      ],
    };
  }

  return {
    code: "generic",
    details: `The model returned text but its JSON could not be parsed (${errMsg}). The response preview is included for debugging.`,
    suggestions: [
      "Try again — JSON-format slips are often transient",
      "Switch to a model with stronger JSON adherence (e.g. with native JSON mode)",
      "Check server logs for the full raw response",
    ],
  };
}
