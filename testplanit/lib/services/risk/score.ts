import type {
  CaseRiskSignals,
  RiskComponentKey,
  RiskComponentScore,
  RiskFacts,
  RiskScoreResult,
  RiskWeights,
} from "./types";
import { priorityWeightFor } from "~/lib/schemas/riskPriorityWeights";
import { RISK_COMPONENT_KEYS } from "./types";

/** Each older verdict counts this much of the next-newer one. */
const FAILURE_DECAY = 0.75;
/** Below this many sampled verdicts a case carries no flakiness signal. */
const MIN_FLAKY_SAMPLES = 3;
/** Days without execution at which staleness saturates. */
export const STALENESS_HORIZON_DAYS = 90;
/** Criticality bump while a linked requirement changed after the last run. */
const SUSPECT_BOOST = 0.25;
/** Two unweighted critical defects saturate the defect component. */
const DEFECT_SATURATION = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recency-weighted share of failing verdicts (newest first). */
function failureHistoryScore(verdicts: boolean[]): number {
  if (verdicts.length === 0) return 0;
  let failed = 0;
  let total = 0;
  let decay = 1;
  for (const passed of verdicts) {
    if (!passed) failed += decay;
    total += decay;
    decay *= FAILURE_DECAY;
  }
  return failed / total;
}

function flakinessScore(verdicts: boolean[]): { raw: number; flips: number } {
  let flips = 0;
  for (let i = 1; i < verdicts.length; i++) {
    if (verdicts[i] !== verdicts[i - 1]) flips++;
  }
  if (verdicts.length < MIN_FLAKY_SAMPLES) return { raw: 0, flips };
  return { raw: flips / (verdicts.length - 1), flips };
}

/** Never-executed cases age from their creation date. */
function stalenessScore(signals: CaseRiskSignals, now: Date): number {
  const reference = signals.lastExecutedAt ?? signals.createdAt;
  const days = (now.getTime() - reference.getTime()) / DAY_MS;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(1, days / STALENESS_HORIZON_DAYS);
}

function criticalityScore(
  signals: CaseRiskSignals,
  priorityWeights: Map<string, number>
): {
  raw: number;
  topRequirementPriority: string | null;
} {
  let top: string | null = null;
  let topWeight = 0;
  for (const priority of signals.requirementPriorities) {
    const weight = priorityWeightFor(priority, priorityWeights);
    if (weight > topWeight) {
      topWeight = weight;
      top = priority;
    }
  }
  const caseWeight = signals.caseCriticalityWeight ?? 0;
  let raw = Math.max(topWeight, caseWeight) / 100;
  if (signals.suspectLinkCount > 0) raw = Math.min(1, raw + SUSPECT_BOOST);
  return { raw, topRequirementPriority: top };
}

function defectScore(
  signals: CaseRiskSignals,
  priorityWeights: Map<string, number>
): {
  raw: number;
  topDefectPriority: string | null;
} {
  let sum = 0;
  let top: string | null = null;
  let topWeight = 0;
  for (const priority of signals.defectPriorities) {
    const weight = priorityWeightFor(priority, priorityWeights);
    sum += weight;
    if (weight > topWeight) {
      topWeight = weight;
      top = priority;
    }
  }
  return { raw: Math.min(1, sum / DEFECT_SATURATION), topDefectPriority: top };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Deterministic: same signals + weights + now always yield the same result.
 * The score is the weight-normalized blend of the five components, 0-100.
 */
export function computeRiskScore(
  signals: CaseRiskSignals,
  weights: RiskWeights,
  priorityWeights: Map<string, number>,
  now: Date
): RiskScoreResult {
  const flakiness = flakinessScore(signals.verdicts);
  const criticality = criticalityScore(signals, priorityWeights);
  const defects = defectScore(signals, priorityWeights);
  const raws: Record<RiskComponentKey, number> = {
    failureHistory: failureHistoryScore(signals.verdicts),
    flakiness: flakiness.raw,
    staleness: stalenessScore(signals, now),
    criticality: criticality.raw,
    defects: defects.raw,
  };
  const totalWeight = RISK_COMPONENT_KEYS.reduce(
    (sum, key) => sum + weights[key],
    0
  );
  const components: RiskComponentScore[] = RISK_COMPONENT_KEYS.map((key) => ({
    key,
    raw: round3(raws[key]),
    weight: weights[key],
    points: round1(
      totalWeight > 0 ? (100 * raws[key] * weights[key]) / totalWeight : 0
    ),
  }));
  const exact =
    totalWeight > 0
      ? RISK_COMPONENT_KEYS.reduce(
          (sum, key) => sum + 100 * raws[key] * weights[key],
          0
        ) / totalWeight
      : 0;
  const score = Math.min(100, Math.max(0, Math.round(exact)));
  const facts: RiskFacts = {
    verdictsSampled: signals.verdicts.length,
    failCount: signals.verdicts.filter((passed) => !passed).length,
    flips: flakiness.flips,
    lastExecutedAt: signals.lastExecutedAt
      ? signals.lastExecutedAt.toISOString()
      : null,
    requirementCount: signals.requirementPriorities.length,
    topRequirementPriority: criticality.topRequirementPriority,
    suspectLinkCount: signals.suspectLinkCount,
    defectCount: signals.defectPriorities.length,
    topDefectPriority: defects.topDefectPriority,
    caseCriticality: signals.caseCriticality,
    quarantined: signals.quarantined,
  };
  return { score, reasons: { version: 1, components, facts } };
}
