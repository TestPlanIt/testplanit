/**
 * Automation Candidates report — generate endpoint.
 *
 *   POST /api/reports/automation-candidates
 *   Body: { projectId: number }
 *
 * Calls the project's configured LLM to rank every manual test case by
 * automation priority, persists the result as a shared `LlmReportSnapshot`,
 * and streams progress back to the caller as SSE-style data lines.
 *
 * Why streaming: LLM completion of 16k+ tokens takes 20–60 s, and the user
 * wants to watch the ranking build. Mirrors the existing
 * `/api/llm/generate-test-cases/stream` pattern.
 *
 * Why persist: this is a SHARED report. Once generated, every viewer sees
 * the same ranking until someone explicitly regenerates — the snapshot IS
 * the report, not a cache. The stream is a UX nicety; the snapshot row is
 * the source of truth, written even if the client disconnects mid-stream.
 *
 * Permission model:
 *   - Generate requires `Reporting.canAddEdit` on the project — enforced by
 *     ZenStack policy on the LlmReportSnapshot create call via the
 *     enhanced client. A user without the permission gets a policy denial
 *     before any LLM call.
 *   - Empty-project / no-LLM cases short-circuit BEFORE persisting a row,
 *     so the snapshot history isn't polluted with stub failures.
 */

import { LLM_FEATURES, SYNC_RETRY_PROFILE } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "@/lib/llm/types";
import { prisma } from "@/lib/prisma";
import type { JsonValue } from "@zenstackhq/orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  buildAutomationCandidatesContext,
  DEFAULT_SELECTION_STRATEGY,
  SELECTION_STRATEGIES,
  serializeContextForPrompt,
} from "~/lib/services/reports/automationCandidatesContext";
import { buildHeuristicRanking } from "~/lib/services/reports/automationCandidatesHeuristic";
import { authOptions } from "~/server/auth";

// Long-running LLM completion needs the Node.js runtime; opt out of every
// Next prerender path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — covers the slowest LLM responses

/**
 * Hard upper bound on cases sent to the LLM. Picks the most-recently-
 * created N when the project has more manual cases than this; the rest
 * are surfaced as `truncated: true` + `totalManualCases` in the snapshot
 * output so the UI can warn. Sized for thinking-model headroom: a
 * thinking model's ranking time scales roughly linearly with input
 * count, and at 100 we already push 5–6 minutes for Gemini 2.5 Pro.
 *
 * The user picks a per-generation count via the left-panel slider
 * (`maxCases` in the request body); this constant is the hard ceiling
 * the request can never exceed.
 */
const MAX_CASES_CEILING = 100;
const DEFAULT_MAX_CASES = 25;

const REPORT_TYPE = "automation_candidates";

/**
 * GET /api/reports/automation-candidates
 *
 * ReportBuilder fetches metadata via GET on every preset's endpoint to
 * populate its dimensions/metrics pickers. Snapshot-style LLM reports have
 * neither — there's nothing for the user to configure inline — so we return
 * empty arrays. Mirrors the iteration-matrix preset's GET stub.
 */
export async function GET() {
  return NextResponse.json({ dimensions: [], metrics: [] });
}

const generateBodySchema = z.object({
  projectId: z.number().int().positive(),
  /**
   * How many manual cases to send to the LLM for ranking. Clamped to
   * `[5, MAX_CASES_CEILING]` on the server so a misconfigured client
   * can't drive a long-running expensive call. When omitted, defaults
   * to `DEFAULT_MAX_CASES`.
   */
  maxCases: z.number().int().min(1).max(MAX_CASES_CEILING).optional(),
  /**
   * Which strategy decides which manual cases to send when the project
   * has more than `maxCases`. Defaults to most-executed (regression-
   * frequency proxy = highest ROI target for automation). See
   * `CaseSelectionStrategy` for the menu.
   */
  selectionStrategy: z.enum(SELECTION_STRATEGIES).optional(),
});

const candidateSchema = z.object({
  caseId: z.number().int(),
  rank: z.number().int().min(1),
  score: z.number().min(0).max(100),
  rationale: z.string(),
});

const llmOutputSchema = z.object({
  candidates: z.array(candidateSchema),
  summary: z.string(),
});

/**
 * Per-candidate metrics persisted in the snapshot output. NOT sent to
 * the LLM — these are display-only signals the UI uses to surface the
 * concrete number behind each ranking ("Most Executed → 47 runs",
 * "Longest First → 18m"). Captured at generation time so a snapshot
 * stays consistent: if the case's execution count later changes, the
 * snapshot still tells you what the ranking saw.
 */
interface CandidateMetrics {
  executionCount: number;
  estimateSeconds: number | null;
  flakinessScore: number | null;
  createdAtIso: string;
}

interface SnapshotOutput {
  candidates: Array<
    z.infer<typeof candidateSchema> & {
      metrics: CandidateMetrics;
      /** Case name frozen at generation time. Lets anonymous viewers of
       *  a public Share Link see human-readable names without an
       *  authenticated case-metadata fetch (which they can't make). The
       *  preset still prefers a live fetch when one succeeds so logged-in
       *  viewers pick up renames; this is the fallback. Optional so
       *  pre-rollout snapshots keep rendering. */
      name?: string;
    }
  >;
  summary: string;
  totalManualCases: number;
  rankedCount: number;
  truncated: boolean;
  truncatedSentCount?: number;
  /** Which strategy picked the input set sent to the LLM. Surfaced in
   *  the UI so a viewer can see "this snapshot was generated with the
   *  Most Executed strategy". */
  selectionStrategy: string;
  /** Distinguishes LLM-generated rankings from heuristic fallback runs
   *  (no LLM configured). Defaults to `"llm"` when absent so older
   *  snapshots keep rendering without a badge. */
  generationMode?: "llm" | "heuristic";
}

export async function POST(req: NextRequest) {
  // Shared-report bypass: the public share endpoint
  // (`/api/share/[shareKey]/report`) forwards POSTs server-to-server with
  // this internal header after validating the share link's mode/expiry/
  // revocation. The share link IS the read grant for snapshot-style
  // reports — there's nothing to "generate" for a public viewer, just
  // the latest persisted snapshot to display. Mirrors how
  // `/api/report-builder/iteration-matrix` and others recognize the
  // bypass header.
  const isSharedReportBypass =
    req.headers.get("x-shared-report-bypass") === "true";

  if (isSharedReportBypass) {
    return handleSharedReportBypass(req);
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = generateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const {
    projectId,
    maxCases: requestedMaxCases,
    selectionStrategy: requestedStrategy,
  } = parsed.data;
  // Clamp [5, ceiling]; default when omitted. The client slider already
  // respects [5, 100], but a stale-cached client could submit anything.
  const effectiveMaxCases = Math.max(
    5,
    Math.min(
      MAX_CASES_CEILING,
      typeof requestedMaxCases === "number"
        ? requestedMaxCases
        : DEFAULT_MAX_CASES
    )
  );
  const effectiveStrategy = requestedStrategy ?? DEFAULT_SELECTION_STRATEGY;

  // --- Pre-snapshot gates (no row written until these all pass) ---------

  const projectLlm = await prisma.projectLlmIntegration.findFirst({
    where: {
      projectId,
      isActive: true,
      llmIntegration: { status: "ACTIVE" },
    },
    include: {
      llmIntegration: { include: { llmProviderConfig: true } },
    },
  });
  // No LLM configured? Fall through to the heuristic generator below
  // rather than erroring. The heuristic ranks by the selection strategy's
  // own metric (most_executed → executionCount, longest_first →
  // forecastManual, etc.) and emits a metric-grounded rationale per case.
  const useHeuristic = !projectLlm;

  let context;
  try {
    context = await buildAutomationCandidatesContext(projectId, {
      maxCases: effectiveMaxCases,
      strategy: effectiveStrategy,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load project",
        code: "project_not_found",
      },
      { status: 404 }
    );
  }

  if (context.cases.length === 0) {
    return NextResponse.json(
      {
        // Honest about the filter — the project might have plenty of
        // cases that just don't qualify (already automated, deleted,
        // archived, or in a NOT_STARTED workflow state) rather than
        // literally "every case is automated."
        error:
          "No eligible manual test cases found. The report only ranks cases that are not yet automated, not deleted, not archived, and whose workflow state is In Progress or Done.",
        code: "no_manual_cases",
      },
      { status: 400 }
    );
  }

  // The materializer applied the selection strategy + cap and reports
  // both the cases sent and the totals/truncation flag.
  const cappedCases = context.cases;
  const truncated = context.truncated;

  // --- Snapshot row + LLM call -----------------------------------------

  const enhanced = await getEnhancedDb(session);
  let snapshotId: number;
  try {
    const snapshot = await enhanced.llmReportSnapshot.create({
      data: {
        projectId,
        reportType: REPORT_TYPE,
        status: "running",
        // null llmIntegrationId is the on-disk signal that this snapshot
        // was built by the heuristic fallback — the route reads the
        // strategy off the snapshot's output JSON later regardless of
        // origin, so all the downstream code paths (UI, share, history)
        // stay identical.
        llmIntegrationId: projectLlm ? projectLlm.llmIntegrationId : null,
        generatedById: session.user.id,
      },
      select: { id: true },
    });
    snapshotId = snapshot.id;
  } catch (err) {
    // ZenStack policy rejection on create → user lacks Reporting.canAddEdit.
    return NextResponse.json(
      {
        error:
          "You don't have permission to generate reports for this project.",
        code: "forbidden",
        cause: err instanceof Error ? err.message : String(err),
      },
      { status: 403 }
    );
  }

  // Resolve the prompt + substitute variables. (LLM mode only — the
  // heuristic fallback emits a static rationale per case and doesn't
  // call the LLM.)
  const resolver = new PromptResolver(prisma);
  const resolvedPrompt = useHeuristic
    ? null
    : await resolver.resolve(LLM_FEATURES.AUTOMATION_CANDIDATES, projectId);
  const userPrompt =
    resolvedPrompt?.userPrompt
      .replace("{{PROJECT_NAME}}", context.projectName)
      .replace("{{CASE_COUNT}}", String(cappedCases.length))
      .replace(
        "{{CASES_JSON}}",
        serializeContextForPrompt({ ...context, cases: cappedCases })
      ) ?? "";

  const llmRequest: LlmRequest | null = useHeuristic
    ? null
    : {
        messages: [
          { role: "system", content: resolvedPrompt!.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: resolvedPrompt!.temperature,
        maxTokens: resolvedPrompt!.maxOutputTokens ?? 32000,
        userId: session.user.id,
        feature: LLM_FEATURES.AUTOMATION_CANDIDATES,
        // No per-request timeout: streaming a multi-thousand-token ranked list
        // for up to MAX_CASES_CEILING manual cases can legitimately run 1–2 minutes,
        // which exceeds typical per-project timeouts that were sized for short
        // call-and-respond features (auto-tag, single test-case generation).
        // The route-level `maxDuration = 300` is the ceiling.
        timeout: 0,
        ...SYNC_RETRY_PROFILE,
        metadata: {
          projectId,
          reportType: REPORT_TYPE,
          snapshotId,
          timestamp: new Date().toISOString(),
        },
      };

  // --- Stream the LLM response ----------------------------------------

  const encoder = new TextEncoder();
  let controllerClosed = false;
  function send(controller: ReadableStreamDefaultController, data: object) {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      controllerClosed = true;
    }
  }
  function keepAlive(controller: ReadableStreamDefaultController) {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      controllerClosed = true;
    }
  }

  const manager = LlmManager.getInstance(prisma);

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      let buffered = "";
      try {
        keepAlive(controller); // tell the proxy bytes are flowing
        send(controller, {
          type: "metadata",
          snapshotId,
          totalManualCases: context.totalManualCases,
          rankedCount: cappedCases.length,
          truncated,
          selectionStrategy: context.selectionStrategy,
          // Tell the client up front whether this run is using the
          // heuristic fallback so the UI can show the "No LLM configured"
          // affordance immediately rather than after the snapshot lands.
          heuristic: useHeuristic,
        });

        // --- Heuristic fallback path: no LLM configured -----------------
        // Build the ranking deterministically from the strategy's own
        // metric, emit it as a single synthesized JSON-equivalent chunk
        // (so the client's progressive parser populates the list), then
        // finish. No tokens spent, no streaming wait.
        if (useHeuristic) {
          // Resolve the generator's locale so the heuristic's summary +
          // per-case rationales render in their language. The text is
          // persisted on the snapshot, so this effectively pins the
          // copy to whoever ran the report (same characteristic as the
          // LLM path, which renders in whatever language the model
          // chose to respond in).
          const generatorPrefs = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { userPreferences: { select: { locale: true } } },
          });
          const generatorLocale =
            generatorPrefs?.userPreferences?.locale || "en_US";
          const heuristicOutput = await buildHeuristicRanking(
            context,
            generatorLocale
          );
          const metricsByCaseId = new Map<number, CandidateMetrics>(
            cappedCases.map((c) => [
              c.id,
              {
                executionCount: c.executionCount,
                estimateSeconds: c.estimateSeconds,
                flakinessScore: c.flakinessScore,
                createdAtIso: c.createdAtIso,
              },
            ])
          );
          const nameByCaseId = new Map<number, string>(
            cappedCases.map((c) => [c.id, c.name])
          );
          const enrichedCandidates = heuristicOutput.candidates.map((c) => ({
            ...c,
            metrics: metricsByCaseId.get(c.caseId)!,
            name: nameByCaseId.get(c.caseId),
          }));
          const output: SnapshotOutput = {
            candidates: enrichedCandidates,
            summary: heuristicOutput.summary,
            totalManualCases: context.totalManualCases,
            rankedCount: enrichedCandidates.length,
            truncated,
            ...(truncated ? { truncatedSentCount: cappedCases.length } : {}),
            selectionStrategy: context.selectionStrategy,
            generationMode: "heuristic",
          };
          // Emit as a single chunk so the client's streaming parser
          // populates the live list identically to the LLM path.
          send(controller, {
            type: "chunk",
            delta: JSON.stringify({
              candidates: enrichedCandidates.map(({ metrics: _m, ...c }) => c),
              summary: heuristicOutput.summary,
            }),
          });
          await enhanced.llmReportSnapshot.update({
            where: { id: snapshotId },
            data: {
              status: "complete",
              completedAt: new Date(),
              output: output as unknown as JsonValue,
            },
          });
          send(controller, {
            type: "done",
            snapshotId,
            rankedCount: enrichedCandidates.length,
            heuristic: true,
          });
          return;
        }

        let finishReason: string | undefined;
        try {
          for await (const chunk of manager.chatStream(
            projectLlm!.llmIntegrationId,
            llmRequest!
          )) {
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.delta) {
              buffered += chunk.delta;
              send(controller, { type: "chunk", delta: chunk.delta });
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "LLM stream failed";
          await persistFailure(snapshotId, message, enhanced);
          send(controller, { type: "error", code: "llm_error", message });
          return;
        }

        // Parse + validate the buffered output. The model is instructed to
        // return strict JSON; if it wraps in markdown fences we strip them.
        const cleaned = stripCodeFence(buffered);
        let parsedOutput: z.infer<typeof llmOutputSchema>;
        try {
          parsedOutput = llmOutputSchema.parse(JSON.parse(cleaned));
        } catch (err) {
          const message =
            err instanceof Error
              ? `Could not parse the LLM response: ${err.message}`
              : "Could not parse the LLM response";
          await persistFailure(snapshotId, message, enhanced);
          send(controller, {
            type: "error",
            code: "parse_failed",
            message,
            // First 1KB of the model's output, shown in the UI so users
            // can see *what* came back when parsing fails (e.g. an empty
            // body from a thinking model whose budget got exhausted).
            rawOutputPreview: cleaned.slice(0, 1000),
          });
          return;
        }

        // Hallucination guard: drop any caseId the LLM invented that wasn't
        // in the input set, and re-sort by rank so the snapshot is canonical.
        const metricsByCaseId = new Map<number, CandidateMetrics>(
          cappedCases.map((c) => [
            c.id,
            {
              executionCount: c.executionCount,
              estimateSeconds: c.estimateSeconds,
              flakinessScore: c.flakinessScore,
              createdAtIso: c.createdAtIso,
            },
          ])
        );
        const nameByCaseId = new Map<number, string>(
          cappedCases.map((c) => [c.id, c.name])
        );
        const filtered = parsedOutput.candidates
          .filter((c) => metricsByCaseId.has(c.caseId))
          .sort((a, b) => a.rank - b.rank)
          .map((c) => ({
            ...c,
            // Persist the metrics that drove the ranking so a viewer can
            // see "47 runs" or "18m forecast" next to each candidate even
            // weeks later when those numbers have changed.
            metrics: metricsByCaseId.get(c.caseId)!,
            // Freeze the case name so anonymous viewers of a public
            // Share Link see a human-readable label without needing an
            // authenticated case-metadata fetch.
            name: nameByCaseId.get(c.caseId),
          }));

        const output: SnapshotOutput = {
          candidates: filtered,
          summary: parsedOutput.summary,
          totalManualCases: context.totalManualCases,
          rankedCount: filtered.length,
          truncated,
          ...(truncated ? { truncatedSentCount: cappedCases.length } : {}),
          selectionStrategy: context.selectionStrategy,
          generationMode: "llm",
        };

        await enhanced.llmReportSnapshot.update({
          where: { id: snapshotId },
          data: {
            status: "complete",
            completedAt: new Date(),
            output: output as unknown as JsonValue,
          },
        });

        send(controller, {
          type: "done",
          finishReason,
          snapshotId,
          rankedCount: filtered.length,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected stream failure";
        await persistFailure(snapshotId, message, enhanced).catch(() => {
          /* swallow — persistence already failed */
        });
        send(controller, { type: "error", code: "stream_failed", message });
      } finally {
        clearInterval(heartbeat);
        if (!controllerClosed) {
          controllerClosed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Read-only shared-report path: load the latest complete snapshot for the
 * project carried in the body and return it as JSON (not streaming). Skips
 * session/auth — the bypass header is the share endpoint's signed assertion
 * that it already validated the share link's mode/expiry/password gate.
 *
 * The share endpoint's response repackages our `snapshot` into the share
 * payload's `automationCandidatesSnapshot` field so AutomationCandidatesReportPreset
 * can render via its `prefetchedSnapshot` prop without re-fetching.
 */
async function handleSharedReportBypass(
  req: NextRequest
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const bodyRecord =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const projectId = bodyRecord.projectId;
  if (typeof projectId !== "number" || !Number.isInteger(projectId)) {
    return NextResponse.json(
      { error: "Share is missing a project id" },
      { status: 400 }
    );
  }

  // Prefer the specific snapshot captured at share-creation time so the
  // viewer always sees the ranking the sharer was looking at. Fall back
  // to "latest complete" only when the share predates the snapshotId
  // capture (or for any other reason it's missing) so older share links
  // still resolve to something rather than 404.
  const requestedSnapshotId = bodyRecord.snapshotId;
  const hasSpecificSnapshot =
    typeof requestedSnapshotId === "number" &&
    Number.isInteger(requestedSnapshotId);

  const snapshot = await prisma.llmReportSnapshot.findFirst({
    where: {
      projectId,
      reportType: REPORT_TYPE,
      status: "complete",
      isDeleted: false,
      ...(hasSpecificSnapshot ? { id: requestedSnapshotId } : {}),
    },
    orderBy: hasSpecificSnapshot ? undefined : { completedAt: "desc" },
    include: {
      generatedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ snapshot });
}

async function persistFailure(
  snapshotId: number,
  errorMessage: string,
  db: Awaited<ReturnType<typeof getEnhancedDb>>
): Promise<void> {
  // Soft-delete failed runs rather than leaving them in history. The
  // client already shows the parse/LLM/stream error inline via the SSE
  // `error` frame, so there's no value in keeping a snapshot row a
  // viewer can select and stare at an error card for. The error message
  // is still written to `errorMessage` for audit/debug — soft-delete
  // hides the row from the dropdown without losing the trail.
  await db.llmReportSnapshot
    .update({
      where: { id: snapshotId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: errorMessage.slice(0, 2000),
        isDeleted: true,
      },
    })
    .catch((err) => {
      console.warn("[reports/automation-candidates] persistFailure failed", {
        snapshotId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Coerce the LLM's text response into a parseable JSON object string.
 *
 * Models routinely:
 *   - Wrap the JSON in ```json fences``` (Gemini, sometimes Claude).
 *   - Emit a fence open but no matching close.
 *   - Add a sentence of prose before or after the JSON.
 *   - Mix in trailing whitespace / newlines.
 *
 * Any of those break a strict `JSON.parse(input)`. Rather than chase every
 * combination with regex, slice from the first `{` to the last `}` — the
 * JSON object we asked for is in there somewhere, and everything outside
 * that range is noise we don't need. Falls back to the trimmed input if no
 * brace pair is found so the parse error surfaces with a useful preview.
 */
function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
