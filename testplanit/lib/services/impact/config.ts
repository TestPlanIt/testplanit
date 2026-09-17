/**
 * Caps and thresholds for the Impact selection engine, read from
 * `IMPACT_*` environment variables with safe defaults.
 */

export interface ImpactConfig {
  diffTokenBudget: number;
  truncatePatchChars: number;
  maxPatchFiles: number;
  maxDiffFiles: number;
  truncateCaseName: number;
  truncateTextLong: number;
  truncateOtherField: number;
  aiFullRepoThreshold: number;
  maxAiCandidates: number;
  aiSampleSize: number;
  minSearchScore: number;
  /** Keyword hits scoring under this fraction of the top hit are dropped. */
  searchRelativeCutoff: number;
  maxSearchResults: number;
  bm25Saturation: number;
  minScore: number;
  affectedThreshold: number;
  historyLookbackDays: number;
  historyMaxAnalyses: number;
  maxAnchorFetches: number;
  thinkingBudget: number;
  linkedExpansion: boolean;
  reuseHours: number;
  /** Per analysis: commits whose own file list is fetched for the ISSUE layer. */
  issueMaxCommitFetches: number;
  /** Ticket-key scan on cache refresh: how far back along the branch to look. */
  issueScanLookbackDays: number;
  issueScanMaxCommits: number;
  /** Commits whose file lists the scan fetches; the rest are skipped. */
  issueScanMaxCommitFetches: number;
  /** A commit touching more files than this is treated as noise and skipped. */
  issueScanMaxFilesPerCommit: number;
  /** Manual full-history scan: commits read per run; a rerun continues where the last stopped. */
  issueScanFullMaxCommits: number;
  /** Manual full-history scan: commits whose file lists are read. */
  issueScanFullMaxCommitFetches: number;
  /** Tracker lookups a refresh-time scan may make to import unknown tickets. */
  issueImportMaxLookups: number;
  /** Tracker lookups a full-history scan may make to import unknown tickets. */
  issueImportFullMaxLookups: number;
  /**
   * Pin the declarations a ticket commit touched instead of whole files.
   * Reads each commit's patch; off, the scan only lists changed paths.
   */
  issueScanSymbolPins: boolean;
}

export const IMPACT_CONFIG_DEFAULTS: Readonly<ImpactConfig> = Object.freeze({
  diffTokenBudget: 12000,
  truncatePatchChars: 4000,
  maxPatchFiles: 40,
  maxDiffFiles: 500,
  truncateCaseName: 80,
  truncateTextLong: 100,
  truncateOtherField: 100,
  aiFullRepoThreshold: 250,
  maxAiCandidates: 150,
  aiSampleSize: 50,
  minSearchScore: 5,
  searchRelativeCutoff: 0.1,
  maxSearchResults: 500,
  bm25Saturation: 20,
  minScore: 20,
  affectedThreshold: 50,
  historyLookbackDays: 365,
  historyMaxAnalyses: 25,
  maxAnchorFetches: 50,
  thinkingBudget: 1024,
  linkedExpansion: true,
  reuseHours: 24,
  issueMaxCommitFetches: 25,
  issueScanLookbackDays: 90,
  issueScanMaxCommits: 300,
  issueScanMaxCommitFetches: 100,
  issueScanMaxFilesPerCommit: 50,
  issueScanFullMaxCommits: 20000,
  issueScanFullMaxCommitFetches: 2000,
  issueImportMaxLookups: 100,
  issueImportFullMaxLookups: 5000,
  issueScanSymbolPins: true,
});

type EnvLike = Record<string, string | undefined>;

function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** A number in [0, 1]; anything else falls back. */
function envFraction(value: string | undefined, fallback: number): number {
  const parsed = envNumber(value, fallback);
  return parsed <= 1 ? parsed : fallback;
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/** Build an ImpactConfig from an env map; invalid values fall back to defaults. */
export function readImpactConfig(env: EnvLike = process.env): ImpactConfig {
  const d = IMPACT_CONFIG_DEFAULTS;
  return {
    diffTokenBudget: envInt(env.IMPACT_DIFF_TOKEN_BUDGET, d.diffTokenBudget),
    truncatePatchChars: envInt(
      env.IMPACT_TRUNCATE_PATCH_CHARS,
      d.truncatePatchChars
    ),
    maxPatchFiles: envInt(env.IMPACT_MAX_PATCH_FILES, d.maxPatchFiles),
    maxDiffFiles: envInt(env.IMPACT_MAX_DIFF_FILES, d.maxDiffFiles),
    truncateCaseName: envInt(env.IMPACT_TRUNCATE_CASE_NAME, d.truncateCaseName),
    truncateTextLong: envInt(env.IMPACT_TRUNCATE_TEXT_LONG, d.truncateTextLong),
    truncateOtherField: envInt(
      env.IMPACT_TRUNCATE_OTHER_FIELD,
      d.truncateOtherField
    ),
    aiFullRepoThreshold: envInt(
      env.IMPACT_AI_FULL_REPO_THRESHOLD,
      d.aiFullRepoThreshold
    ),
    maxAiCandidates: envInt(env.IMPACT_MAX_AI_CANDIDATES, d.maxAiCandidates),
    aiSampleSize: envInt(env.IMPACT_AI_SAMPLE_SIZE, d.aiSampleSize),
    minSearchScore: envNumber(env.IMPACT_MIN_SEARCH_SCORE, d.minSearchScore),
    searchRelativeCutoff: envFraction(
      env.IMPACT_SEARCH_RELATIVE_CUTOFF,
      d.searchRelativeCutoff
    ),
    maxSearchResults: envInt(env.IMPACT_MAX_SEARCH_RESULTS, d.maxSearchResults),
    bm25Saturation: envNumber(env.IMPACT_BM25_SATURATION, d.bm25Saturation),
    minScore: envInt(env.IMPACT_MIN_SCORE, d.minScore),
    affectedThreshold: envInt(
      env.IMPACT_AFFECTED_THRESHOLD,
      d.affectedThreshold
    ),
    historyLookbackDays: envInt(
      env.IMPACT_HISTORY_LOOKBACK_DAYS,
      d.historyLookbackDays
    ),
    historyMaxAnalyses: envInt(
      env.IMPACT_HISTORY_MAX_ANALYSES,
      d.historyMaxAnalyses
    ),
    maxAnchorFetches: envInt(env.IMPACT_MAX_ANCHOR_FETCHES, d.maxAnchorFetches),
    thinkingBudget: envInt(env.IMPACT_THINKING_BUDGET, d.thinkingBudget),
    linkedExpansion: envBool(env.IMPACT_LINKED_EXPANSION, d.linkedExpansion),
    reuseHours: envNumber(env.IMPACT_REUSE_HOURS, d.reuseHours),
    issueMaxCommitFetches: envInt(
      env.IMPACT_ISSUE_MAX_COMMIT_FETCHES,
      d.issueMaxCommitFetches
    ),
    issueScanLookbackDays: envInt(
      env.IMPACT_ISSUE_SCAN_LOOKBACK_DAYS,
      d.issueScanLookbackDays
    ),
    issueScanMaxCommits: envInt(
      env.IMPACT_ISSUE_SCAN_MAX_COMMITS,
      d.issueScanMaxCommits
    ),
    issueScanMaxCommitFetches: envInt(
      env.IMPACT_ISSUE_SCAN_MAX_COMMIT_FETCHES,
      d.issueScanMaxCommitFetches
    ),
    issueScanMaxFilesPerCommit: envInt(
      env.IMPACT_ISSUE_SCAN_MAX_FILES_PER_COMMIT,
      d.issueScanMaxFilesPerCommit
    ),
    issueScanFullMaxCommits: envInt(
      env.IMPACT_ISSUE_SCAN_FULL_MAX_COMMITS,
      d.issueScanFullMaxCommits
    ),
    issueScanFullMaxCommitFetches: envInt(
      env.IMPACT_ISSUE_SCAN_FULL_MAX_COMMIT_FETCHES,
      d.issueScanFullMaxCommitFetches
    ),
    issueImportMaxLookups: envInt(
      env.IMPACT_ISSUE_IMPORT_MAX_LOOKUPS,
      d.issueImportMaxLookups
    ),
    issueImportFullMaxLookups: envInt(
      env.IMPACT_ISSUE_IMPORT_FULL_MAX_LOOKUPS,
      d.issueImportFullMaxLookups
    ),
    issueScanSymbolPins: envBool(
      env.IMPACT_ISSUE_SCAN_SYMBOL_PINS,
      d.issueScanSymbolPins
    ),
  };
}

export const impactConfig: ImpactConfig = readImpactConfig();
