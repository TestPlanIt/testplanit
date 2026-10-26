import { sql } from "kysely";
import { z } from "zod/v4";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { extractJsonObject } from "~/lib/llm/services/json-extract";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "~/lib/llm/types";
import { fillPrompt } from "~/lib/llm/services/prompt-fill";
import type { TriageDb, VerdictHistory } from "./signatures";
import {
  countFlips,
  formatVerdicts,
  getCaseVerdictHistory,
  FLAKY_HISTORY_WINDOW,
} from "./signatures";

/**
 * LLM classification of failure signatures.
 *
 * The model sees one signature at a time: its exception, message, a sample
 * stack trace, and how the affected cases behaved recently. Its answer is
 * stored on the `ai*` columns; it becomes the effective classification only
 * while nobody has classified the signature by hand.
 */

/** One catalogue entry as the parser and the prompt see it. */
export interface ClassificationCatalogueEntry {
  id: number;
  name: string;
  /** Stable identifier of a seeded entry (PRODUCT_BUG, TEST_BUG, ENVIRONMENT, FLAKY). */
  key: string | null;
  description: string | null;
}

export const STACK_TRACE_MAX_CHARS = 4000;
export const SYSTEM_ERR_MAX_CHARS = 1500;
export const MESSAGE_MAX_CHARS = 600;
export const AFFECTED_CASES_MAX = 10;

const classificationOutputSchema = z.object({
  classification: z.string(),
  confidence: z.coerce.number().catch(0.5),
  rationale: z.string().max(2000).catch(""),
  suggestedIssueTitle: z.string().max(300).nullish(),
  suggestedNextStep: z.string().max(1000).nullish(),
});

export interface ParsedClassification {
  classificationId: number;
  confidence: number;
  rationale: string;
  suggestedIssueTitle: string | null;
  suggestedNextStep: string | null;
}

/** Synonyms the model tends to use for the seeded entries, by key. */
const CLASSIFICATION_ALIASES: Record<string, string> = {
  PRODUCT: "PRODUCT_BUG",
  BUG: "PRODUCT_BUG",
  APPLICATION_BUG: "PRODUCT_BUG",
  APP_BUG: "PRODUCT_BUG",
  REGRESSION: "PRODUCT_BUG",
  TEST: "TEST_BUG",
  TEST_ISSUE: "TEST_BUG",
  AUTOMATION_BUG: "TEST_BUG",
  ENV: "ENVIRONMENT",
  INFRASTRUCTURE: "ENVIRONMENT",
  INFRA: "ENVIRONMENT",
  FLAKE: "FLAKY",
  INTERMITTENT: "FLAKY",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Maps the model's answer onto a catalogue entry: by name first (case,
 * punctuation and spacing ignored), then by seeded key, then by alias.
 */
export function normalizeClassification(
  value: string,
  catalogue: ClassificationCatalogueEntry[]
): ClassificationCatalogueEntry | null {
  const token = normalizeToken(value);
  if (!token) return null;
  const byName = catalogue.find((c) => normalizeToken(c.name) === token);
  if (byName) return byName;
  const byKey = catalogue.find((c) => c.key === token);
  if (byKey) return byKey;
  const alias = CLASSIFICATION_ALIASES[token];
  if (alias) return catalogue.find((c) => c.key === alias) ?? null;
  return null;
}

/** Parses the model's JSON answer; null when it cannot be read. */
export function parseClassification(
  content: string,
  catalogue: ClassificationCatalogueEntry[]
): ParsedClassification | null {
  const json = extractJsonObject(content);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = classificationOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const classification = normalizeClassification(
    parsed.data.classification,
    catalogue
  );
  if (!classification) return null;
  return {
    classificationId: classification.id,
    confidence: Math.min(1, Math.max(0, parsed.data.confidence)),
    rationale: parsed.data.rationale.trim(),
    suggestedIssueTitle: parsed.data.suggestedIssueTitle?.trim() || null,
    suggestedNextStep: parsed.data.suggestedNextStep?.trim() || null,
  };
}

/** The catalogue as the prompt lists it: one `- name: description` per line. */
export function formatCatalogue(
  catalogue: ClassificationCatalogueEntry[]
): string {
  return catalogue
    .map((c) => `- ${c.name}: ${c.description?.trim() || "(no description)"}`)
    .join("\n");
}

/** Live catalogue entries, in display order. */
export async function loadClassificationCatalogue(
  db: TriageDb
): Promise<ClassificationCatalogueEntry[]> {
  return db.failureClassification.findMany({
    where: { isDeleted: false },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true, name: true, key: true, description: true },
  });
}

export type ClassificationVariables = {
  CLASSIFICATIONS: string;
  EXCEPTION_TYPE: string;
  FAILURE_MESSAGE: string;
  STACK_TRACE: string;
  SYSTEM_ERR: string;
  OCCURRENCE_COUNT: string;
  CASE_COUNT: string;
  RUN_COUNT: string;
  FIRST_SEEN: string;
  LAST_SEEN: string;
  FLAKY_CANDIDATE: string;
  AFFECTED_CASES: string;
};

export interface AffectedCaseContext {
  name: string;
  history: VerdictHistory;
}

export function buildClassificationVariables(input: {
  exceptionType: string | null;
  message: string | null;
  stackTrace: string | null;
  systemErr: string | null;
  occurrenceCount: number;
  caseCount: number;
  runCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  flakyCandidate: boolean;
  cases: AffectedCaseContext[];
  catalogue: ClassificationCatalogueEntry[];
}): ClassificationVariables {
  const clip = (text: string | null, max: number) => {
    const value = (text ?? "").trim();
    if (!value) return "(none)";
    return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
  };
  const cases = input.cases.slice(0, AFFECTED_CASES_MAX).map((c) => {
    const verdicts =
      c.history.length > 0 ? formatVerdicts(c.history) : "(no history)";
    const flips =
      c.history.length > 1 ? `, ${countFlips(c.history)} flip(s)` : "";
    return `- ${c.name} — ${verdicts}${flips}`;
  });
  if (input.cases.length > AFFECTED_CASES_MAX) {
    cases.push(`- …and ${input.cases.length - AFFECTED_CASES_MAX} more`);
  }
  return {
    CLASSIFICATIONS: formatCatalogue(input.catalogue),
    EXCEPTION_TYPE: input.exceptionType ?? "(none)",
    FAILURE_MESSAGE: clip(input.message, MESSAGE_MAX_CHARS),
    STACK_TRACE: clip(input.stackTrace, STACK_TRACE_MAX_CHARS),
    SYSTEM_ERR: clip(input.systemErr, SYSTEM_ERR_MAX_CHARS),
    OCCURRENCE_COUNT: String(input.occurrenceCount),
    CASE_COUNT: String(input.caseCount),
    RUN_COUNT: String(input.runCount),
    FIRST_SEEN: input.firstSeenAt.toISOString(),
    LAST_SEEN: input.lastSeenAt.toISOString(),
    FLAKY_CANDIDATE: input.flakyCandidate ? "yes" : "no",
    AFFECTED_CASES: cases.length > 0 ? cases.join("\n") : "(none)",
  };
}

export { fillPrompt };

export interface ClassifyOutcome {
  classified: number;
  failed: number;
  /** No provider resolved for the project, nothing was attempted */
  skipped: boolean;
}

/**
 * Classifies the given signatures with the project's LLM. Returns
 * `skipped: true` when no provider resolves (the feature is inert then).
 */
export async function classifySignatures(
  db: TriageDb,
  params: {
    llmManager: LlmManager;
    projectId: number;
    signatureIds: number[];
    userId: string;
  }
): Promise<ClassifyOutcome> {
  const { llmManager, projectId, signatureIds, userId } = params;
  if (signatureIds.length === 0)
    return { classified: 0, failed: 0, skipped: false };

  const prompt = await new PromptResolver(db as never).resolve(
    LLM_FEATURES.FAILURE_TRIAGE,
    projectId
  );
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.FAILURE_TRIAGE,
    projectId,
    prompt
  );
  if (!resolved) return { classified: 0, failed: 0, skipped: true };

  const catalogue = await loadClassificationCatalogue(db);
  if (catalogue.length === 0) {
    console.warn(
      "[failure-triage] no failure classifications configured; nothing to classify against"
    );
    return { classified: 0, failed: 0, skipped: true };
  }

  let classified = 0;
  let failed = 0;
  for (const signatureId of signatureIds) {
    try {
      const vars = await loadClassificationVariables(
        db,
        signatureId,
        catalogue
      );
      if (!vars) continue;
      const request: LlmRequest = {
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: fillPrompt(prompt.userPrompt, vars) },
        ],
        temperature: prompt.temperature,
        maxTokens: prompt.maxOutputTokens,
        userId,
        projectId,
        feature: LLM_FEATURES.FAILURE_TRIAGE,
        ...(resolved.model ? { model: resolved.model } : {}),
      };
      const response = await llmManager.chat(resolved.integrationId, request, {
        maxRetries: 2,
        baseDelayMs: 1000,
      });
      const parsed = parseClassification(response.content, catalogue);
      if (!parsed) {
        failed++;
        console.warn(
          `[failure-triage] signature ${signatureId}: unreadable classification`
        );
        continue;
      }
      await storeClassification(
        db,
        signatureId,
        parsed,
        response.model ?? resolved.model ?? null
      );
      classified++;
    } catch (error) {
      failed++;
      console.error(
        `[failure-triage] signature ${signatureId} classification failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return { classified, failed, skipped: false };
}

async function loadClassificationVariables(
  db: TriageDb,
  signatureId: number,
  catalogue: ClassificationCatalogueEntry[]
): Promise<ClassificationVariables | null> {
  const signature = await db.failureSignature.findUnique({
    where: { id: signatureId },
    select: {
      exceptionType: true,
      normalizedMessage: true,
      occurrenceCount: true,
      caseCount: true,
      runCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      flakyCandidate: true,
    },
  });
  if (!signature) return null;

  const sample = await db.jUnitTestResult.findFirst({
    where: { failureSignatureId: signatureId },
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    select: { message: true, content: true, systemErr: true },
  });

  const caseRows = await sql<{ id: number; name: string }>`
    SELECT rc.id, rc.name
    FROM "RepositoryCases" rc
    WHERE rc.id IN (
      SELECT DISTINCT r."repositoryCaseId"
      FROM "JUnitTestResult" r
      WHERE r."failureSignatureId" = ${signatureId}
    )
    ORDER BY rc.name
    LIMIT ${AFFECTED_CASES_MAX + 1}
  `.execute(db.$qb);
  const history = await getCaseVerdictHistory(
    db,
    caseRows.rows.map((r) => r.id),
    FLAKY_HISTORY_WINDOW
  );

  return buildClassificationVariables({
    exceptionType: signature.exceptionType,
    message: sample?.message ?? signature.normalizedMessage,
    stackTrace: sample?.content ?? null,
    systemErr: sample?.systemErr ?? null,
    occurrenceCount: signature.occurrenceCount,
    caseCount: signature.caseCount,
    runCount: signature.runCount,
    firstSeenAt: signature.firstSeenAt,
    lastSeenAt: signature.lastSeenAt,
    flakyCandidate: signature.flakyCandidate,
    cases: caseRows.rows.map((r) => ({
      name: r.name,
      history: history.get(r.id) ?? [],
    })),
    catalogue,
  });
}

/** Writes the AI answer; it becomes effective only without a manual classification. */
export async function storeClassification(
  db: TriageDb,
  signatureId: number,
  parsed: ParsedClassification,
  model: string | null
): Promise<void> {
  const now = new Date();
  const current = await db.failureSignature.findUnique({
    where: { id: signatureId },
    select: { classifiedById: true },
  });
  const manual = current?.classifiedById != null;
  await db.failureSignature.update({
    where: { id: signatureId },
    data: {
      aiClassificationId: parsed.classificationId,
      aiConfidence: parsed.confidence,
      aiRationale: parsed.rationale || null,
      aiSuggestedIssueTitle: parsed.suggestedIssueTitle,
      aiSuggestedNextStep: parsed.suggestedNextStep,
      aiModel: model,
      aiClassifiedAt: now,
      ...(manual
        ? {}
        : {
            classificationId: parsed.classificationId,
            classificationSource: "AI",
            classifiedAt: now,
          }),
    },
  });
}
