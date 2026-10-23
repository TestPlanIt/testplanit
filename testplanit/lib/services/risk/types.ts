import type { DbClient, TxClient } from "~/lib/zenstack";

export type RiskDb = DbClient | TxClient;

export { RISK_COMPONENT_KEYS } from "~/lib/schemas/riskWeights";
export type { RiskComponentKey, RiskWeights } from "~/lib/schemas/riskWeights";
import type { RiskComponentKey } from "~/lib/schemas/riskWeights";

/** Raw per-case inputs the scorer turns into a score. */
export interface CaseRiskSignals {
  caseId: number;
  /** Last automated verdicts, newest first; `true` = passed. */
  verdicts: boolean[];
  /** Latest manual-or-automated execution; null = never executed. */
  lastExecutedAt: Date | null;
  createdAt: Date;
  /** Effective priority string of each linked live requirement. */
  requirementPriorities: (string | null)[];
  /** Linked requirements whose content changed after the last execution. */
  suspectLinkCount: number;
  /** Effective priority string of each linked live defect. */
  defectPriorities: (string | null)[];
  /** Option name of the project's chosen criticality field, for display. */
  caseCriticality: string | null;
  /** Order-derived 0-100 weight of that option; null = no value or no field. */
  caseCriticalityWeight: number | null;
  quarantined: boolean;
}

export type RiskComponentScore = {
  key: RiskComponentKey;
  /** Normalized 0..1 before weighting. */
  raw: number;
  weight: number;
  /** Contribution to the final 0-100 score. */
  points: number;
};

/**
 * Stable inputs behind the score. Deliberately free of day counters: the
 * recompute skips the write (and the Elasticsearch sync) when the rounded
 * score and these facts are unchanged, so a quiet project costs nothing
 * nightly even though staleness drifts.
 */
export type RiskFacts = {
  verdictsSampled: number;
  failCount: number;
  flips: number;
  lastExecutedAt: string | null;
  requirementCount: number;
  topRequirementPriority: string | null;
  suspectLinkCount: number;
  defectCount: number;
  topDefectPriority: string | null;
  caseCriticality: string | null;
  quarantined: boolean;
};

/** What `RepositoryCases.riskReasons` persists; versioned for UI evolution. */
export type RiskReasons = {
  version: 1;
  components: RiskComponentScore[];
  facts: RiskFacts;
};

export interface RiskScoreResult {
  score: number;
  reasons: RiskReasons;
}

// Job payloads; tenantId routes shared workers (lib/multiTenantDb.ts).
export interface RiskRunJobData {
  testRunId: number;
  projectId: number;
  tenantId?: string;
}

export interface RiskProjectJobData {
  projectId: number;
  tenantId?: string;
  /** Set when a user asked for the recompute (settings backfill button). */
  requestedById?: string;
}

export interface RiskUpdateAllJobData {
  tenantId?: string;
}

export type RiskScoreJobData =
  RiskRunJobData | RiskProjectJobData | RiskUpdateAllJobData;
