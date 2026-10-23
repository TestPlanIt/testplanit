import { z } from "zod";
import type { RiskWeights } from "./types";
import { RISK_COMPONENT_KEYS } from "./types";

/**
 * System default component weights. Relative, not percentages: the score
 * normalizes by their sum, so a project can zero out or over-weight one
 * component without re-balancing the rest.
 */
export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  failureHistory: 30,
  flakiness: 15,
  staleness: 15,
  criticality: 25,
  defects: 15,
};

export const MAX_RISK_WEIGHT = 100;

const weightField = z.number().min(0).max(MAX_RISK_WEIGHT);

/** Shape of `Projects.riskWeights`; partial on purpose — unset keys fall back. */
export const riskWeightsSchema = z
  .object({
    failureHistory: weightField,
    flakiness: weightField,
    staleness: weightField,
    criticality: weightField,
    defects: weightField,
  })
  .partial();

/** Never throws: anything unusable falls back to the system defaults. */
export function resolveRiskWeights(value: unknown): RiskWeights {
  const resolved: RiskWeights = { ...DEFAULT_RISK_WEIGHTS };
  if (!value || typeof value !== "object") return resolved;
  const parsed = riskWeightsSchema.safeParse(value);
  if (!parsed.success) return resolved;
  for (const key of RISK_COMPONENT_KEYS) {
    const weight = parsed.data[key];
    if (typeof weight === "number" && Number.isFinite(weight)) {
      resolved[key] = weight;
    }
  }
  return resolved;
}

/**
 * Priority strings → 0-100 weight, case-insensitive. Covers TestPlanIt's
 * seeded options plus common tracker vocabularies (Jira names, Azure DevOps
 * bare numbers); an unmapped string scores as "medium" so an exotic tracker
 * never zeroes criticality out.
 */
const PRIORITY_WEIGHTS: Record<string, number> = {
  blocker: 100,
  critical: 100,
  highest: 100,
  urgent: 100,
  p0: 100,
  high: 75,
  major: 75,
  p1: 75,
  medium: 50,
  normal: 50,
  moderate: 50,
  p2: 50,
  low: 25,
  minor: 25,
  p3: 25,
  lowest: 10,
  trivial: 10,
  p4: 10,
  "1": 100,
  "2": 75,
  "3": 50,
  "4": 25,
};

export const UNKNOWN_PRIORITY_WEIGHT = 50;

export function priorityWeight(priority: string | null | undefined): number {
  if (!priority) return UNKNOWN_PRIORITY_WEIGHT;
  const normalized = priority.trim().toLowerCase();
  if (!normalized) return UNKNOWN_PRIORITY_WEIGHT;
  return PRIORITY_WEIGHTS[normalized] ?? UNKNOWN_PRIORITY_WEIGHT;
}
