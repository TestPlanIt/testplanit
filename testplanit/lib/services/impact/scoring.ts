/**
 * Per-layer score functions for the Impact engine. Every score is 0-100.
 */

import type { HistoryReason, PathReason, PinReason } from "./types";

export type CodePinKind = PinReason["pinKind"];

export const PATH_SCORE_CAP = 60;
export const HISTORY_SCORE_CAP = 70;
export const HISTORY_SCORE_FLOOR = 25;
export const AI_SCORE_CAP = 95;
export const LINKED_SCORE_CAP = 40;
/** A commit in the range named a ticket the case is linked to. */
export const ISSUE_SCORE = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Map a raw BM25 score onto 0-60 against the result set's max, saturating. */
export function normalizeBm25(
  raw: number,
  maxInResult: number,
  saturation: number
): number {
  if (!(raw > 0)) return 0;
  const denominator = Math.max(maxInResult, saturation);
  const ratio = denominator > 0 ? raw / denominator : 1;
  return Math.max(10, Math.round(60 * Math.min(1, ratio)));
}

export interface EsScoreContext {
  maxInResult: number;
  saturation: number;
}

function distinctTerms(reasons: PathReason[]): number {
  const terms = new Set<string>();
  for (const reason of reasons) {
    const term = reason.term?.trim().toLowerCase();
    if (term) terms.add(term);
  }
  return terms.size;
}

/** Score the PATH layer for one case from its match reasons. */
export function pathScoreFor(
  reasons: PathReason[],
  es: EsScoreContext = { maxInResult: 0, saturation: 20 }
): number {
  if (reasons.length === 0) return 0;
  const nameTerms = distinctTerms(
    reasons.filter((r) => r.matchedField === "db.name")
  );
  let best = 0;
  for (const reason of reasons) {
    let score = 0;
    switch (reason.matchedField) {
      case "es.name":
      case "es.searchableContent":
        score = normalizeBm25(
          reason.rawScore ?? 0,
          es.maxInResult,
          es.saturation
        );
        break;
      case "db.tag":
        score = 45;
        break;
      case "db.folder":
        score = 35;
        break;
      case "db.name":
        score = Math.min(60, 20 + 15 * nameTerms);
        break;
    }
    best = Math.max(best, score);
  }
  const extraTerms = Math.max(0, distinctTerms(reasons) - 1);
  return Math.min(PATH_SCORE_CAP, best + 5 * extraTerms);
}

function historyHitScore(hit: HistoryReason): number {
  if (hit.failed) return 70;
  if (hit.addedManually) return 60;
  if (hit.overlap === "file") return 40;
  return 25;
}

/** Score the HISTORY layer for one case from its prior-analysis hits. */
export function historyScoreFor(
  hits: HistoryReason[],
  now: Date,
  decayAfterDays = 180,
  analysisDates: Map<number, Date> = new Map()
): number {
  if (hits.length === 0) return 0;
  const cutoff = now.getTime() - decayAfterDays * DAY_MS;
  let best = 0;
  const analyses = new Set<number>();
  for (const hit of hits) {
    analyses.add(hit.analysisId);
    const analysisDate = analysisDates.get(hit.analysisId);
    const decayed =
      analysisDate !== undefined && analysisDate.getTime() < cutoff;
    const score = historyHitScore(hit) * (decayed ? 0.7 : 1);
    best = Math.max(best, score);
  }
  const extraAnalyses = Math.max(0, analyses.size - 1);
  const total = Math.round(best + 5 * extraAnalyses);
  return Math.min(HISTORY_SCORE_CAP, Math.max(HISTORY_SCORE_FLOOR, total));
}

/** Clamp a model-reported score into 0-95 so AI never outranks a pin. */
export function clampAiScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(AI_SCORE_CAP, Math.max(0, Math.round(score)));
}

/** Score a case reached only through a link from a strongly selected case. */
export function linkedScoreFor(parentScore: number): number {
  if (!Number.isFinite(parentScore) || parentScore <= 0) return 0;
  return Math.min(LINKED_SCORE_CAP, Math.round(parentScore / 2));
}

/** Tie-break weight: more specific pins sort first at equal score. */
export function pinSpecificity(kind: CodePinKind): number {
  switch (kind) {
    case "RANGE":
    case "SYMBOL":
      return 3;
    case "FILE":
      return 2;
    case "GLOB":
      return 1;
    default:
      return 0;
  }
}
