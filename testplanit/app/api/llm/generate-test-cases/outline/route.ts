import { LLM_FEATURES, SYNC_RETRY_PROFILE } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest, LlmResponse } from "@/lib/llm/types";
import { baseDb } from "@/lib/db";
import { ProjectAccessType } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { IntegrationManager } from "~/lib/integrations/IntegrationManager";
import type {
  IssueAdapter,
  IssueComment,
  LinkedIssueRef,
} from "~/lib/integrations/adapters/IssueAdapter";
import { authOptions } from "~/server/auth";
import {
  buildOutlineSystemPrompt,
  buildOutlineUserPrompt,
  fetchHierarchyContext,
  fetchLinkedIssuesContext,
  type GenerationContext,
  type IssueData,
  type LinkedIssueContext,
  type TestCaseOutline,
} from "../shared";
import {
  OUTLINE_CTX_MIN_USEFUL,
  OUTLINE_RETRY_MAX_DEPTH,
  getStartingBudget,
  isTimeoutError,
  recordWorkingBudget,
} from "./adaptive-budget";

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
    const {
      projectId,
      issue,
      context,
      quantity,
      enrichFromIssue,
      integrationId: sourceIntegrationId,
    } = body as {
      projectId: number;
      issue: IssueData;
      context: GenerationContext;
      quantity?: string;
      includeParameters?: boolean;
      // Opt-in: fetch the source issue's comments + one-hop linked issues from
      // its tracker and fold them into the prompt. Set only for real synced
      // issues (repository issue-search flow, milestone SYNCED rows). Left
      // false for documents, URLs, and manual issues so we never make a
      // pointless/incorrect adapter call.
      enrichFromIssue?: boolean;
      // Optional source integration for enrichment. Milestone-issue generation
      // passes the issue's own integration; the repository wizard omits it and
      // falls back to the project's first active integration.
      integrationId?: number;
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

    const project = await baseDb.projects.findFirst({
      where: projectAccessWhere,
      include: {
        projectIntegrations: {
          where: { isActive: true },
          include: { integration: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

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
      return NextResponse.json(
        { error: "No active LLM integration found for this project" },
        { status: 400 }
      );
    }

    // Forward the project's resolved generation prompt so language/tone
    // preferences also apply to the titles (which become the test case names).
    const styleGuidance =
      resolvedPrompt.source !== "fallback"
        ? resolvedPrompt.systemPrompt
        : undefined;
    const systemPrompt = buildOutlineSystemPrompt(quantity, styleGuidance);

    let maxTokens = resolvedPrompt.maxOutputTokens ?? 2048;
    const providerConfig = await (baseDb as any).llmProviderConfig.findFirst({
      where: { llmIntegrationId: resolved.integrationId },
    });
    if (providerConfig) {
      maxTokens =
        providerConfig.defaultMaxTokens ??
        resolvedPrompt.maxOutputTokens ??
        2048;
    }

    const integrationId = resolved.integrationId;
    const { maxRetries, baseDelayMs } = SYNC_RETRY_PROFILE;

    // --- Issue enrichment (parity with the single-shot /stream path) ---
    // Resolve the issue-tracking adapter best-effort. Prefer an explicit
    // source integration (milestone issues carry their own), otherwise fall
    // back to the project's first active integration (the repository wizard's
    // flow). A client-supplied integrationId must belong to the project.
    let adapter: IssueAdapter | null = null;
    const allowedIntegrationIds = new Set(
      project.projectIntegrations.map((pi) => pi.integrationId)
    );
    const targetIntegrationId =
      sourceIntegrationId && allowedIntegrationIds.has(sourceIntegrationId)
        ? sourceIntegrationId
        : project.projectIntegrations[0]?.integrationId;
    if (enrichFromIssue && targetIntegrationId && issue.key) {
      try {
        adapter = await IntegrationManager.getInstance().getAdapter(
          String(targetIntegrationId)
        );
      } catch (err) {
        console.warn(
          `[outline] Failed to resolve issue-tracking adapter for project %s:`,
          projectId,
          err
        );
        adapter = null;
      }
    }

    // Source-issue comments come from the adapter server-side (server is the
    // source of truth). Fail-soft to [] — e.g. manual issues with no adapter.
    let sourceComments: IssueComment[] = [];
    if (adapter?.getIssueComments && issue.key) {
      try {
        sourceComments = await adapter.getIssueComments(issue.key);
      } catch (err) {
        console.warn(
          `[outline] Failed to fetch source-issue comments for %s:`,
          issue.key,
          err
        );
        sourceComments = [];
      }
    }
    const issueWithComments: IssueData = { ...issue, comments: sourceComments };

    // One-hop linked issues, fetched ONCE here (outside the adaptive-budget
    // retry loop). They don't change between retries, and re-fetching would
    // re-hit the adapter. Bounded by the starting context budget; folder
    // hierarchy cases claim whatever budget the linked issues don't use and
    // shrink first on a timeout retry.
    const startingBudget = getStartingBudget(integrationId);
    const linkedResult: {
      included: LinkedIssueContext[];
      dropped: LinkedIssueRef[];
      tokensUsed: number;
    } =
      startingBudget > 0 && adapter?.getLinkedIssues && issue.key
        ? await fetchLinkedIssuesContext(adapter, issue.key, startingBudget)
        : { included: [], dropped: [], tokensUsed: 0 };

    // Run the LLM with an adaptive existing-cases context budget. On a
    // timeout we halve the budget and retry within the same request, up to
    // OUTLINE_RETRY_MAX_DEPTH halvings. The smaller working budget is
    // remembered for subsequent calls; a clean success grows it back up.
    const runWithBudget = async (
      budget: number,
      depth: number
    ): Promise<{ response: LlmResponse; finalBudget: number }> => {
      const effectiveBudget = budget < OUTLINE_CTX_MIN_USEFUL ? 0 : budget;

      // Linked issues (fetched once above) get first claim on the budget;
      // folder hierarchy cases get the remainder.
      const hierarchyBudget = Math.max(
        0,
        effectiveBudget - linkedResult.tokensUsed
      );
      const hierarchyContext =
        hierarchyBudget > 0 && typeof context.folderContext === "number"
          ? await fetchHierarchyContext(
              baseDb,
              projectId,
              context.folderContext,
              hierarchyBudget,
              "names"
            )
          : [];

      const enrichedContext: GenerationContext = {
        ...context,
        existingTestCases: hierarchyContext,
        linkedIssues: linkedResult.included,
      };
      const userPrompt = buildOutlineUserPrompt(
        issueWithComments,
        enrichedContext
      );

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

      try {
        const response = await manager.chat(integrationId, llmRequest, {
          maxRetries,
          baseDelayMs,
        });
        return { response, finalBudget: effectiveBudget };
      } catch (err) {
        if (
          isTimeoutError(err) &&
          effectiveBudget > 0 &&
          depth < OUTLINE_RETRY_MAX_DEPTH
        ) {
          const next = Math.floor(effectiveBudget / 2);
          console.warn(
            `[outline] Timeout with context budget=${effectiveBudget}, retrying with budget=${next} (depth ${depth + 1}/${OUTLINE_RETRY_MAX_DEPTH})`
          );
          recordWorkingBudget(integrationId, next);
          return runWithBudget(next, depth + 1);
        }
        throw err;
      }
    };

    const { response, finalBudget } = await runWithBudget(startingBudget, 0);

    // Remember the budget that worked so the next call starts at a sane size
    // (then grows on subsequent successes via getStartingBudget).
    recordWorkingBudget(integrationId, finalBudget);

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

    // Return the assembled enrichment so the client can thread it into each
    // expand call (fetched once here) and surface any linked issues that were
    // dropped for budget. `comments`/`linkedIssues` are empty for un-enriched
    // (e.g. manual) issues.
    return NextResponse.json({
      outlines: parsed.outlines,
      enrichment: {
        comments: sourceComments,
        linkedIssues: linkedResult.included,
        droppedLinkedIssues: linkedResult.dropped.map(
          (r) => r.key ?? String(r.id)
        ),
      },
    });
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
