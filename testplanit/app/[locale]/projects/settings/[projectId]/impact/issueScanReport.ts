import type { IssueScanReport } from "~/lib/services/impact/issueScan";
import type { RepoJobBehind } from "~/lib/services/impact/repoJobStatus";

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

export interface IssueScanQueued {
  full: boolean;
  requestedAt: string | null;
  /** What the worker is busy with, when the queue said. */
  behind: RepoJobBehind | null;
}

export type IssueScanReportView =
  | { kind: "never" }
  | { kind: "queued"; queued: IssueScanQueued }
  | {
      kind: "running";
      progress: IssueScanRunning;
      /** The queue holds the job, but progress stopped a while ago. */
      unresponsive: boolean;
    }
  /** The queue lost the job while the report still said running. */
  | {
      kind: "interrupted";
      full: boolean;
      startedAt: string | null;
      scannedAt: string | null;
    }
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

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const BEHIND_KINDS = new Set([
  "scan-issues",
  "stale-pins",
  "refresh-cache",
  "sweep",
  "other",
]);

/** The `behind` the status resolver attaches to a queued report. */
export function readJobBehind(raw: unknown): RepoJobBehind | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.kind !== "string" || !BEHIND_KINDS.has(record.kind)) {
    return null;
  }
  return {
    kind: record.kind as RepoJobBehind["kind"],
    configId: typeof record.configId === "number" ? record.configId : null,
  };
}

/**
 * Classifies the `issueScanReport` JSON stored on an IMPACT config, as the
 * queue-backed status resolver hands it out: `{ queued: true }` while the
 * job waits, `{ running: true, ... }` with progress counts while a scan
 * walks the branch, `{ interrupted: true }` when the queue lost the job,
 * `{ cancelled: true }`, `{ error, scannedAt }` when the scan failed, or
 * the full `IssueScanReport` when it ran.
 */
export function readIssueScanReport(raw: unknown): IssueScanReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const scannedAt = asString(record.scannedAt);
  const full = record.full === true;

  if (record.running === true) {
    return {
      kind: "running",
      unresponsive: record.unresponsive === true,
      progress: {
        full,
        stage:
          record.stage === "import" || record.stage === "inspect"
            ? record.stage
            : "walk",
        startedAt: asString(record.startedAt),
        progressAt: asString(record.progressAt),
        scannedCommits: asNumber(record.scannedCommits),
        cachedCommits: asNumber(record.cachedCommits),
        matchedCommits: asNumber(record.matchedCommits),
        fetchedCommits: asNumber(record.fetchedCommits),
        importLookups: asNumber(record.importLookups),
        importedIssues: asNumber(record.importedIssues),
      },
    };
  }
  if (record.queued === true) {
    return {
      kind: "queued",
      queued: {
        full,
        requestedAt: asString(record.requestedAt),
        behind: readJobBehind(record.behind),
      },
    };
  }
  if (record.interrupted === true) {
    return {
      kind: "interrupted",
      full,
      startedAt: asString(record.startedAt),
      scannedAt,
    };
  }
  if (typeof record.error === "string") {
    return { kind: "error", error: record.error, scannedAt };
  }
  if (record.cancelled === true) {
    return { kind: "cancelled", full, scannedAt };
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
      full,
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

/** A scan is queued or running: the buttons wait and the page keeps polling. */
export function isIssueScanInFlight(view: IssueScanReportView): boolean {
  return view.kind === "queued" || view.kind === "running";
}
