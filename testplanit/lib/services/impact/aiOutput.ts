import { z } from "zod/v4";
import { extractJsonObject } from "~/lib/llm/services/json-extract";
import type { AiReason, LayerCandidate, LayerResult } from "./types";

import { AI_SCORE_CAP, clampAiScore } from "./scoring";

export { AI_SCORE_CAP, clampAiScore };
const RATIONALE_MAX_LENGTH = 200;
const SELECTION_OBJECT_PATTERN = /\{[^{}]*"caseId"[^{}]*\}/g;

export const aiSelectionSchema = z.object({
  caseId: z.number().int(),
  score: z.number().min(0).max(100),
  rationale: z.string().max(400),
  files: z.array(z.string()).optional(),
});

export const aiOutputSchema = z.object({
  selections: z.array(aiSelectionSchema),
  uncoveredFiles: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;
type RawSelection = z.infer<typeof aiSelectionSchema>;

export interface AiSelection {
  caseId: number;
  score: number;
  rationale: string;
  files: string[];
}

export interface AiBatchResult {
  batchIndex: number;
  selections: AiSelection[];
  uncoveredFiles: string[];
  summary: string;
  partial: boolean;
  droppedIds: number[];
  parseError?: string;
}

export interface ValidateAiBatchOptions {
  validIds: Set<number>;
  changedPaths: Set<string>;
  batchIndex: number;
  finishReason?: string;
}

export interface MergedAiSelection extends AiSelection {
  batchIndex: number;
}

export interface MergedAiOutput {
  selections: MergedAiSelection[];
  uncoveredFiles: string[];
  summary: string;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`
    )
    .join("; ");
}

/** Recover the complete selection objects from output cut off mid-array. */
export function salvageTruncatedJson(raw: string): RawSelection[] {
  const matches = raw.match(SELECTION_OBJECT_PATTERN) ?? [];
  const salvaged: RawSelection[] = [];
  for (const match of matches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match);
    } catch {
      continue;
    }
    const result = aiSelectionSchema.safeParse(parsed);
    if (result.success) salvaged.push(result.data);
  }
  return salvaged;
}

function parseOutput(raw: string): { output: AiOutput } | { error: string } {
  const json = extractJsonObject(raw);
  if (json === null) {
    return {
      error: raw.trim() ? "no JSON object in response" : "empty response",
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "invalid JSON" };
  }
  const result = aiOutputSchema.safeParse(value);
  return result.success
    ? { output: result.data }
    : { error: describeIssues(result.error) };
}

export function validateAiBatch(
  // A provider can answer without text at all: a response carrying only a
  // thinking block, or a stop the adapter maps to no content. That is an
  // empty answer to report, not a crash that loses the whole batch.
  raw: string | null | undefined,
  opts: ValidateAiBatchOptions
): AiBatchResult {
  const { validIds, changedPaths, batchIndex } = opts;
  const text = typeof raw === "string" ? raw : "";
  const empty = (parseError: string, partial: boolean): AiBatchResult => ({
    batchIndex,
    selections: [],
    uncoveredFiles: [],
    summary: "",
    partial,
    droppedIds: [],
    parseError,
  });

  const parsed = parseOutput(text);
  let output: AiOutput;
  let partial = false;
  if ("output" in parsed) {
    output = parsed.output;
  } else if (opts.finishReason === "length") {
    const salvaged = salvageTruncatedJson(text);
    if (salvaged.length === 0) return empty(parsed.error, true);
    partial = true;
    output = { selections: salvaged, uncoveredFiles: [], summary: "" };
  } else {
    return empty(parsed.error, false);
  }

  const byId = new Map<number, AiSelection>();
  const dropped = new Set<number>();
  for (const selection of output.selections) {
    if (!validIds.has(selection.caseId)) {
      dropped.add(selection.caseId);
      continue;
    }
    const candidate: AiSelection = {
      caseId: selection.caseId,
      score: selection.score,
      rationale: selection.rationale.trim().slice(0, RATIONALE_MAX_LENGTH),
      files: unique(
        (selection.files ?? []).filter((path) => changedPaths.has(path))
      ),
    };
    const existing = byId.get(selection.caseId);
    if (!existing || candidate.score > existing.score) {
      byId.set(selection.caseId, candidate);
    }
  }

  return {
    batchIndex,
    selections: Array.from(byId.values()),
    uncoveredFiles: unique(
      output.uncoveredFiles.filter((path) => changedPaths.has(path))
    ),
    summary: output.summary.trim(),
    partial,
    droppedIds: Array.from(dropped),
  };
}

export function mergeAiBatches(batches: AiBatchResult[]): MergedAiOutput {
  const byId = new Map<number, MergedAiSelection>();
  const covered = new Set<string>();
  for (const batch of batches) {
    for (const selection of batch.selections) {
      for (const path of selection.files) covered.add(path);
      const existing = byId.get(selection.caseId);
      if (!existing || selection.score > existing.score) {
        byId.set(selection.caseId, {
          ...selection,
          batchIndex: batch.batchIndex,
        });
      }
    }
  }

  const mentioningFiles = batches.filter(
    (batch) =>
      batch.uncoveredFiles.length > 0 ||
      batch.selections.some((selection) => selection.files.length > 0)
  );
  const uncoveredFiles =
    mentioningFiles.length === 0
      ? []
      : mentioningFiles[0].uncoveredFiles.filter(
          (path) =>
            !covered.has(path) &&
            mentioningFiles.every((batch) =>
              batch.uncoveredFiles.includes(path)
            )
        );

  const summary =
    batches.map((batch) => batch.summary).find((text) => text.length > 0) ?? "";

  return {
    selections: Array.from(byId.values()).sort(
      (a, b) => b.score - a.score || a.caseId - b.caseId
    ),
    uncoveredFiles,
    summary,
  };
}

export function toAiLayer(
  merged: MergedAiOutput,
  batchIndexByCase?: Map<number, number>
): LayerResult {
  const layer: LayerResult = new Map<number, LayerCandidate>();
  for (const selection of merged.selections) {
    const score = clampAiScore(selection.score);
    const reason: AiReason = {
      kind: "AI",
      rationale: selection.rationale,
      score,
      batchIndex:
        batchIndexByCase?.get(selection.caseId) ?? selection.batchIndex,
    };
    if (selection.files.length > 0) reason.files = selection.files;
    layer.set(selection.caseId, {
      caseId: selection.caseId,
      score,
      reasons: [reason],
    });
  }
  return layer;
}
