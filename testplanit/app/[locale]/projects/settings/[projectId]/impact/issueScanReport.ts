import type { IssueScanReport } from "~/lib/services/impact/issueScan";

export type IssueScanRunningStage = "walk" | "import" | "inspect";

export interface IssueScanRunning {
  full: boolean;
  stage: IssueScanRunningStage;
  startedAt: string | null;
  /** When the worker last wrote progress. */
  progressAt: string | null;
  scannedCommits: number;
  cachedCommits: number;
  matchedCommits: number;
  fetchedCommits: number;
  importLookups: number;
  importedIssues: number;
}

/** A running flag older than this with no progress is treated as abandoned. */
export const ISSUE_SCAN_STALE_MS = 30 * 60 * 1000;

/**
 * True when a scan's running flag looks left behind: the worker that owned
 * it died or never knew the job, so nothing will clear it. The page then
 * offers to queue the scan again rather than waiting on it.
 */
export function isIssueScanStale(
  progress: IssueScanRunning,
  now: number = Date.now()
): boolean {
  const last = progress.progressAt ?? progress.startedAt;
  if (!last) return true;
  const at = Date.parse(last);
  if (!Number.isFinite(at)) return true;
  return now - at > ISSUE_SCAN_STALE_MS;
}

export type IssueScanReportView =
  | { kind: "never" }
  | { kind: "running"; progress: IssueScanRunning }
  | { kind: "error"; error: string; scannedAt: string | null }
  | { kind: "cancelled"; full: boolean; scannedAt: string | null }
  | {
      kind: "scanned";
      report: IssueScanReport;
      /** False for reports written before the naming counters existed. */
      namingCountsKnown: boolean;
    };

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Classifies the `issueScanReport` JSON stored on an IMPACT config. The
 * repo-cache worker writes `{ running: true, ... }` with progress counts while
 * a scan walks the branch, `{ error, scannedAt }` when the scan failed, or the
 * full `IssueScanReport` when it ran.
 */
export function readIssueScanReport(raw: unknown): IssueScanReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const scannedAt =
    typeof record.scannedAt === "string" ? record.scannedAt : null;

  if (record.running === true) {
    return {
      kind: "running",
      progress: {
        full: record.full === true,
        stage:
          record.stage === "import" || record.stage === "inspect"
            ? record.stage
            : "walk",
        startedAt:
          typeof record.startedAt === "string" ? record.startedAt : null,
        progressAt:
          typeof record.progressAt === "string" ? record.progressAt : null,
        scannedCommits: asNumber(record.scannedCommits),
        cachedCommits: asNumber(record.cachedCommits),
        matchedCommits: asNumber(record.matchedCommits),
        fetchedCommits: asNumber(record.fetchedCommits),
        importLookups: asNumber(record.importLookups),
        importedIssues: asNumber(record.importedIssues),
      },
    };
  }
  if (typeof record.error === "string") {
    return { kind: "error", error: record.error, scannedAt };
  }
  if (record.cancelled === true) {
    return { kind: "cancelled", full: record.full === true, scannedAt };
  }
  if (scannedAt === null) {
    return { kind: "never" };
  }

  return {
    kind: "scanned",
    namingCountsKnown:
      typeof record.commitsNamingTickets === "number" &&
      typeof record.namedTickets === "number",
    report: {
      scannedCommits: asNumber(record.scannedCommits),
      cachedCommits: asNumber(record.cachedCommits),
      commitsNamingTickets: asNumber(record.commitsNamingTickets),
      namedTickets: asNumber(record.namedTickets),
      matchedCommits: asNumber(record.matchedCommits),
      skippedLargeCommits: asNumber(record.skippedLargeCommits),
      issues: asNumber(record.issues),
      created: asNumber(record.created),
      updated: asNumber(record.updated),
      removed: asNumber(record.removed),
      unchanged: asNumber(record.unchanged),
      fetchCapped: record.fetchCapped === true,
      truncated: record.truncated === true,
      full: record.full === true,
      importedIssues: asNumber(record.importedIssues),
      importFailures: asNumber(record.importFailures),
      importSkipped: asNumber(record.importSkipped),
      importMoved: asNumber(record.importMoved),
      createdSymbolPins: asNumber(record.createdSymbolPins),
      importFailureDetails: Array.isArray(record.importFailureDetails)
        ? record.importFailureDetails
            .filter(
              (item): item is { key: string; error: string } =>
                !!item &&
                typeof item === "object" &&
                typeof (item as { key?: unknown }).key === "string" &&
                typeof (item as { error?: unknown }).error === "string"
            )
            .map((item) => ({ key: item.key, error: item.error }))
        : [],
      scannedAt,
    },
  };
}
