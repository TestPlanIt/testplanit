import { z } from "zod/v4";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { extractJsonObject } from "~/lib/llm/services/json-extract";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { fillPrompt } from "~/lib/llm/services/prompt-fill";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "~/lib/llm/types";
import { parseRiskReasons } from "~/lib/schemas/riskReasons";
import {
  RATIONALE_MAX_CHARS,
  RERANK_MAX_CANDIDATES,
} from "~/lib/schemas/riskRerank";
import type { RiskDb } from "./types";

/**
 * LLM re-rank of risk candidates for one run being composed.
 *
 * The stored risk score is deterministic, free and knows only a case's own
 * history. This asks a model to re-order a BOUNDED slice of that ranking for
 * the run in hand — promoting what this run is actually about, demoting what
 * it has no bearing on — and to say why per case. Nothing here is persisted:
 * the answer lives in the job's return value and dies with the dialog, so a
 * project that never opens it pays nothing.
 */

export {
  RATIONALE_MAX_CHARS,
  RERANK_MAX_CANDIDATES,
} from "~/lib/schemas/riskRerank";

/** Longest run description the prompt carries. */
export const RUN_CONTEXT_MAX_CHARS = 2000;

/** What the run being composed is about, as the dialog knows it. */
export interface RerankRunContext {
  name: string;
  description?: string | null;
  tags?: string[];
}

export interface RerankedCase {
  caseId: number;
  rationale: string;
  /** False for a candidate the model never mentioned, kept in score order. */
  ranked: boolean;
}

export interface RerankOutcome {
  /** Every candidate, best first. Empty only when nothing was rankable. */
  ranked: RerankedCase[];
  /** Candidates handed to the model. */
  candidateCount: number;
  /** How many of them the model actually placed; the rest kept score order. */
  rankedCount: number;
  /** Candidates dropped by the cap, which keep their score order below. */
  droppedCount: number;
  /** Set when no provider resolves, or the model's answer was unusable. */
  skipped?: "no_provider" | "unreadable";
  model?: string | null;
}

/** One entry; a bad one becomes null so the rest of the ranking survives. */
const rerankEntrySchema = z
  .object({
    id: z.coerce.number().int(),
    rationale: z.string().catch(""),
  })
  .nullable()
  .catch(null);

const rerankOutputSchema = z.object({
  ranked: z.array(rerankEntrySchema).catch([]),
});

interface CandidateRow {
  id: number;
  name: string;
  riskScore: number | null;
  riskReasons: unknown;
  folder?: { name: string } | null;
}

/** Collapses whitespace so one candidate stays one line. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** One line of evidence per case: the facts behind its standing score. */
export function describeCandidate(row: CandidateRow): string {
  const parts: string[] = [];
  const reasons = parseRiskReasons(row.riskReasons);
  if (reasons) {
    const f = reasons.facts;
    if (f.verdictsSampled > 0) {
      parts.push(`${f.failCount}/${f.verdictsSampled} recent results failed`);
    }
    if (f.flips > 0) parts.push(`${f.flips} pass/fail flips`);
    parts.push(
      f.lastExecutedAt
        ? `last run ${f.lastExecutedAt.slice(0, 10)}`
        : "never run"
    );
    if (f.requirementCount > 0) {
      parts.push(
        `${f.requirementCount} requirement(s)${
          f.topRequirementPriority ? ` (top ${f.topRequirementPriority})` : ""
        }`
      );
    }
    if (f.suspectLinkCount > 0) {
      parts.push(`${f.suspectLinkCount} requirement(s) changed since last run`);
    }
    if (f.defectCount > 0) {
      parts.push(
        `${f.defectCount} defect(s)${
          f.topDefectPriority ? ` (top ${f.topDefectPriority})` : ""
        }`
      );
    }
    if (f.caseCriticality) parts.push(`criticality ${f.caseCriticality}`);
    if (f.quarantined) parts.push("quarantined");
  }
  // One candidate per line, so a name carrying newlines must not become
  // several — the system prompt says names are data, and this keeps the
  // shape that claim relies on.
  const name = oneLine(row.name);
  const folder = row.folder?.name ? ` [${oneLine(row.folder.name)}]` : "";
  const score = row.riskScore == null ? "unscored" : Math.round(row.riskScore);
  return `#${row.id} ${name}${folder} — risk ${score}${
    parts.length > 0 ? `: ${parts.join("; ")}` : ""
  }`;
}

/** The run's own words, trimmed to what a prompt can carry. */
export function describeRunContext(context: RerankRunContext): string {
  const lines = [`Name: ${context.name || "(unnamed)"}`];
  const description = (context.description ?? "").trim();
  if (description) {
    lines.push(
      `Description: ${description.slice(0, RUN_CONTEXT_MAX_CHARS)}${
        description.length > RUN_CONTEXT_MAX_CHARS ? "…" : ""
      }`
    );
  }
  if (context.tags?.length) lines.push(`Tags: ${context.tags.join(", ")}`);
  return lines.join("\n");
}

/** Whole `{ "id": n, "rationale": "..." }` objects from a cut-off answer. */
function salvageEntries(text: string): { id: number; rationale: string }[] {
  const out: { id: number; rationale: string }[] = [];
  const pattern =
    /\{\s*"id"\s*:\s*(\d+)\s*,\s*"rationale"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  for (const match of text.matchAll(pattern)) {
    out.push({ id: Number(match[1]), rationale: match[2] });
  }
  return out;
}

/** A model's answer, or null when it is not JSON this can read at all. */
export function parseRerankOutput(
  content: string
): { id: number; rationale: string }[] | null {
  const json = extractJsonObject(content);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // A long ranking can be cut off at the output limit, which leaves the
    // JSON unparseable while most of the order survived. The entries that
    // did arrive are the top of the list — the part that matters.
    const salvaged = salvageEntries(json);
    return salvaged.length > 0 ? salvaged : null;
  }
  const parsed = rerankOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const entries = parsed.data.ranked.filter(
    (entry): entry is { id: number; rationale: string } => entry != null
  );
  return entries.length > 0 ? entries : null;
}

/**
 * Keeps the model's order where it is usable and the score order everywhere
 * else: ids it invented or repeated are dropped, and every candidate it
 * failed to mention keeps its place at the end rather than vanishing from a
 * list the user is choosing from.
 */
export function reconcileRanking(
  candidateIds: number[],
  ranked: { id: number; rationale: string }[]
): RerankedCase[] {
  const candidates = new Set(candidateIds);
  const seen = new Set<number>();
  const out: RerankedCase[] = [];
  for (const entry of ranked) {
    if (!candidates.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({
      caseId: entry.id,
      rationale: entry.rationale.trim().slice(0, RATIONALE_MAX_CHARS),
      ranked: true,
    });
  }
  for (const id of candidateIds) {
    if (!seen.has(id)) out.push({ caseId: id, rationale: "", ranked: false });
  }
  return out;
}

export async function rerankRiskCandidates(
  db: RiskDb,
  params: {
    llmManager: LlmManager;
    projectId: number;
    caseIds: number[];
    runContext: RerankRunContext;
    userId: string;
  }
): Promise<RerankOutcome> {
  const { llmManager, projectId, runContext, userId } = params;
  const requested = [
    ...new Set(params.caseIds.filter((id) => Number.isInteger(id))),
  ];
  const capped = requested.slice(0, RERANK_MAX_CANDIDATES);
  const droppedCount = requested.length - capped.length;
  if (capped.length === 0) {
    return { ranked: [], candidateCount: 0, rankedCount: 0, droppedCount };
  }

  const prompt = await new PromptResolver(db as never).resolve(
    LLM_FEATURES.RISK_RERANK,
    projectId
  );
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.RISK_RERANK,
    projectId,
    prompt
  );
  if (!resolved) {
    return {
      ranked: [],
      candidateCount: 0,
      rankedCount: 0,
      droppedCount,
      skipped: "no_provider",
    };
  }

  // Read through the caller's client: the worker passes a raw client, so the
  // project scope here is what keeps one project's ids out of another's.
  const rows = (await db.repositoryCases.findMany({
    where: {
      id: { in: capped },
      projectId,
      isDeleted: false,
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      riskScore: true,
      riskReasons: true,
      folder: { select: { name: true } },
    },
  })) as CandidateRow[];
  if (rows.length === 0) {
    return { ranked: [], candidateCount: 0, rankedCount: 0, droppedCount };
  }

  // Hand them over in the order the user is looking at, highest score first.
  const order = new Map(capped.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const candidateIds = rows.map((row) => row.id);

  const request: LlmRequest = {
    messages: [
      { role: "system", content: prompt.systemPrompt },
      {
        role: "user",
        content: fillPrompt(prompt.userPrompt, {
          RUN_CONTEXT: describeRunContext(runContext),
          CANDIDATES: rows.map(describeCandidate).join("\n"),
          CANDIDATE_COUNT: String(rows.length),
        }),
      },
    ],
    temperature: prompt.temperature,
    maxTokens: prompt.maxOutputTokens,
    userId,
    projectId,
    feature: LLM_FEATURES.RISK_RERANK,
    ...(resolved.model ? { model: resolved.model } : {}),
  };
  const response = await llmManager.chat(resolved.integrationId, request, {
    maxRetries: 2,
    baseDelayMs: 1000,
  });

  const parsed = parseRerankOutput(response.content);
  if (!parsed) {
    console.warn(
      `[risk-rerank] project ${projectId}: unreadable ranking for ${rows.length} candidates`
    );
    return {
      ranked: [],
      candidateCount: rows.length,
      rankedCount: 0,
      droppedCount,
      skipped: "unreadable",
      model: resolved.model ?? null,
    };
  }

  const ranked = reconcileRanking(candidateIds, parsed);
  return {
    ranked,
    candidateCount: rows.length,
    rankedCount: ranked.filter((entry) => entry.ranked).length,
    droppedCount,
    model: resolved.model ?? null,
  };
}
