/**
 * Which cases the AI layer is asked to rank. The other signals settle some
 * cases on their own: a matching Code Pin, or a score at or above the
 * affected threshold from a ticket, keyword, or run-history match. Those are
 * withheld from the model and named in the prompt as already selected. The
 * undecided cases go to the model strongest signal first, within the cap,
 * and any room left under the cap is filled with cases from the same folders
 * so the model can catch what no signal named.
 */

import type { ImpactConfig } from "./config";
import type { LayerResult } from "./types";

export interface AiCandidatePlanInput {
  repositoryTotalCount: number;
  /** Cases the pin layer selected. */
  pinnedCaseIds: number[];
  /** The other non-AI layers: issue, path, history. */
  layers: LayerResult[];
  cfg: Pick<
    ImpactConfig,
    | "aiFullRepoThreshold"
    | "maxAiCandidates"
    | "aiSampleSize"
    | "affectedThreshold"
  >;
}

export interface AiCandidatePlan {
  /** A small repository: every case not settled is a candidate. */
  full: boolean;
  /** Withheld from the model, ascending: pinned, or already at the affected threshold. */
  settledIds: number[];
  /** Ranked mode: candidates in signal order, strongest first, within the cap. */
  rankedIds: number[];
  /** Ranked mode: how many folder neighbours may be added under the cap. */
  neighbourSlots: number;
  /** Ranked mode: cases whose folders seed the neighbour sample. */
  anchorIds: number[];
}

export function planAiCandidates(input: AiCandidatePlanInput): AiCandidatePlan {
  const { cfg } = input;
  const best = new Map<number, number>();
  for (const layer of input.layers) {
    for (const candidate of layer.values()) {
      best.set(
        candidate.caseId,
        Math.max(best.get(candidate.caseId) ?? 0, candidate.score)
      );
    }
  }

  const settled = new Set<number>(input.pinnedCaseIds);
  for (const [caseId, score] of best) {
    if (score >= cfg.affectedThreshold) settled.add(caseId);
  }
  const settledIds = [...settled].sort((a, b) => a - b);

  if (input.repositoryTotalCount <= cfg.aiFullRepoThreshold) {
    return {
      full: true,
      settledIds,
      rankedIds: [],
      neighbourSlots: 0,
      anchorIds: [],
    };
  }

  const rankedIds = [...best.entries()]
    .filter(([caseId]) => !settled.has(caseId))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([caseId]) => caseId)
    .slice(0, cfg.maxAiCandidates);
  const neighbourSlots = Math.max(
    0,
    Math.min(cfg.aiSampleSize, cfg.maxAiCandidates - rankedIds.length)
  );

  return {
    full: false,
    settledIds,
    rankedIds,
    neighbourSlots,
    anchorIds: [...settledIds, ...rankedIds],
  };
}
