/**
 * Shared shapes for the Impact selection engine. Pure types only; the worker,
 * routes and UI all speak these.
 */

import type { ChangedFileStatus } from "~/lib/integrations/adapters/GitRepoAdapter";
import type { DiffHunk } from "~/lib/integrations/diff/parseUnifiedDiff";
import type { CodePinKind } from "./pinMatcher";

// ---------------------------------------------------------------------------
// Diff summary (what the prompt and the layers see)
// ---------------------------------------------------------------------------

export type DiffFileClass =
  | "source"
  | "config"
  | "test"
  | "docs"
  | "generated"
  | "lockfile"
  | "vendored"
  | "minified"
  | "binary";

export type DiffDetailLevel = "patch" | "hunks" | "path";

export interface DiffHunkSummary {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changedSymbols?: string[];
}

export interface DiffFileSummary {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  class: DiffFileClass;
  hunks: DiffHunkSummary[];
  /** Present only when detail === "patch". */
  patchExcerpt?: string;
  detail: DiffDetailLevel;
}

export interface DiffSummary {
  baseSha: string;
  headSha: string;
  /** Included files in prompt order. */
  files: DiffFileSummary[];
  excludedFiles: Array<{ path: string; class: DiffFileClass }>;
  totalFiles: number;
  truncatedByProvider: boolean;
  truncatedByBudget: boolean;
  omittedFileCount: number;
  estimatedTokens: number;
}

/** Per-file hunk record as persisted on ImpactAnalysis.diffSummary. */
export interface DiffFileRecord {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patchTruncated?: boolean;
  hunks: DiffHunk[];
}

// ---------------------------------------------------------------------------
// Reasons, layers, scored cases
// ---------------------------------------------------------------------------

export type PinReason = {
  kind: "PIN";
  pinId: number;
  filePath: string;
  pinKind: CodePinKind;
  source: "MANUAL" | "AI" | "ANNOTATION" | "MAPFILE";
  lines?: [number, number];
  symbol?: string;
  touchedRanges?: Array<[number, number]>;
  confidence: "exact" | "normalized" | "fuzzy" | "file" | "glob";
  stale?: boolean;
  staleReason?: string;
};

export type PathReason = {
  kind: "PATH";
  term: string;
  matchedField:
    "es.name" | "es.searchableContent" | "db.name" | "db.tag" | "db.folder";
  filePath?: string;
  rawScore?: number;
};

export type HistoryReason = {
  kind: "HISTORY";
  analysisId: number;
  testRunId: number;
  overlap: "file" | "dir";
  failed: boolean;
  addedManually: boolean;
  overlappingPaths: string[];
};

export type AiReason = {
  kind: "AI";
  rationale: string;
  score: number;
  files?: string[];
  batchIndex: number;
};

export type LinkedReason = {
  kind: "LINKED";
  viaCaseId: number;
  linkType: string;
};

export type SelectionReason =
  PinReason | PathReason | HistoryReason | AiReason | LinkedReason;

export type ReasonKind = SelectionReason["kind"];

export interface LayerCandidate {
  caseId: number;
  score: number;
  reasons: SelectionReason[];
}

export type LayerResult = Map<number, LayerCandidate>;

export type CaseTier = "pinned" | "affected" | "related";

export interface ScoredCase {
  caseId: number;
  /** 0-100, max over layers. */
  score: number;
  tier: CaseTier;
  layers: ReasonKind[];
  reasons: SelectionReason[];
  /** Changed paths this case is evidence for. */
  coveredFiles: string[];
}

export interface StalePin {
  pinId: number;
  caseId: number;
  filePath: string;
  pinKind: CodePinKind;
  reason: string;
  suggestedPath?: string;
}

export type AnalysisWarningCode =
  | "diff_truncated_by_provider"
  | "diff_truncated_by_budget"
  | "llm_not_configured"
  | "search_fallback_db"
  | "search_index_empty"
  | "ai_partial"
  | "ai_truncated"
  | "no_candidates"
  | "anchor_fetch_capped";

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  detail?: Record<string, unknown>;
}

export type SearchMode = "es" | "db" | "none";

export interface AnalysisStats {
  repositoryTotalCount: number;
  candidateCount: number;
  aiCandidateCount: number;
  layerCounts: Record<ReasonKind, number>;
  searchMode: SearchMode;
  ai?: {
    model: string;
    tokens: { prompt: number; completion: number; total: number };
    batchCount: number;
    failedBatchCount: number;
    truncatedBatches: number[];
  };
  durationsMs: Partial<Record<ImpactPhase, number>>;
}

/** The engine's output, persisted on ImpactAnalysis.result (minus cases). */
export interface AnalysisResult {
  analysisId: number;
  baseSha: string;
  headSha: string;
  diff: DiffSummary;
  cases: ScoredCase[];
  stalePins: StalePin[];
  uncoveredFiles: string[];
  /** AI summary, or "" when AI did not run. */
  summary: string;
  warnings: AnalysisWarning[];
  stats: AnalysisStats;
}

// ---------------------------------------------------------------------------
// Worker job shapes
// ---------------------------------------------------------------------------

export type ImpactPhase =
  | "resolving_config"
  | "fetching_diff"
  | "matching_pins"
  | "searching_cases"
  | "scoring_history"
  | "waiting_for_ai"
  | "merging";

export const IMPACT_PHASES: ImpactPhase[] = [
  "resolving_config",
  "fetching_diff",
  "matching_pins",
  "searching_cases",
  "scoring_history",
  "waiting_for_ai",
  "merging",
];

export interface ImpactAnalysisJobData {
  analysisId: number;
  projectId: number;
  configId: number;
  baseSha: string;
  headSha: string;
  userId: string;
  notes?: string;
  excludeCaseIds?: number[];
  tenantId?: string;
}

export interface ImpactProgress {
  phase: ImpactPhase;
  /** i18n key suffix under runs.impact.loading.* */
  message: string;
  filesTotal?: number;
  filesIncluded?: number;
  pinsMatched?: number;
  pinsStale?: number;
  candidates?: number;
  casesRanked?: number;
  casesToRank?: number;
  selectedSoFar?: number;
}

export interface ImpactAnalysisJobResult {
  analysisId: number;
  status: "complete";
  caseCount: number;
  pinnedCount: number;
  affectedCount: number;
  uncoveredCount: number;
  warnings: AnalysisWarningCode[];
}
