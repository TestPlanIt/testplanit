import { z } from "zod";

/**
 * Risk scorer component weights: shape of `Projects.riskWeights` and the
 * system defaults. Lives in lib/schemas (not lib/services/risk) so client
 * pages can import it without pulling server-only modules into the bundle.
 */

/** Weighted components of the deterministic risk score, in display order. */
export const RISK_COMPONENT_KEYS = [
  "failureHistory",
  "flakiness",
  "staleness",
  "criticality",
  "defects",
] as const;

export type RiskComponentKey = (typeof RISK_COMPONENT_KEYS)[number];

/** Relative component weights; resolved against DEFAULT_RISK_WEIGHTS. */
export type RiskWeights = Record<RiskComponentKey, number>;

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
