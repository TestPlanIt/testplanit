import type {
  MarkerScanProblem,
  MarkerScanReport,
} from "~/lib/services/impact/markerScan";

export type MarkerScanSkipReason = "privacy_mode" | "partial_contents";

export type MarkerScanReportView =
  | { kind: "never" }
  | { kind: "skipped"; reason: MarkerScanSkipReason; scannedAt: string | null }
  | { kind: "error"; error: string; scannedAt: string | null }
  | {
      kind: "scanned";
      report: MarkerScanReport;
      /** `detail` of the first `MARKER_PROBLEM_PREVIEW_LIMIT` problems. */
      problemDetails: string[];
    };

export const MARKER_PROBLEM_PREVIEW_LIMIT = 5;

const SKIP_REASONS: ReadonlySet<string> = new Set<MarkerScanSkipReason>([
  "privacy_mode",
  "partial_contents",
]);

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asProblems(value: unknown): MarkerScanProblem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry &&
    typeof entry === "object" &&
    typeof (entry as { detail?: unknown }).detail === "string"
      ? [
          {
            kind: (entry as MarkerScanProblem).kind,
            detail: (entry as MarkerScanProblem).detail,
          },
        ]
      : []
  );
}

/**
 * Classifies the `markerScanReport` JSON stored on an IMPACT config. The
 * cache-refresh worker writes one of three shapes: `{ skipped, scannedAt }`
 * when the scan could not run, `{ error, scannedAt }` when it failed, or the
 * full `MarkerScanReport` when it ran.
 */
export function readMarkerScanReport(raw: unknown): MarkerScanReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const scannedAt =
    typeof record.scannedAt === "string" ? record.scannedAt : null;

  if (typeof record.skipped === "string") {
    return SKIP_REASONS.has(record.skipped)
      ? {
          kind: "skipped",
          reason: record.skipped as MarkerScanSkipReason,
          scannedAt,
        }
      : { kind: "never" };
  }

  if (typeof record.error === "string") {
    return { kind: "error", error: record.error, scannedAt };
  }

  if (scannedAt === null) {
    return { kind: "never" };
  }

  const problems = asProblems(record.problems);
  const report: MarkerScanReport = {
    scannedFiles: asNumber(record.scannedFiles),
    skippedFiles: asNumber(record.skippedFiles),
    annotationMarkers: asNumber(record.annotationMarkers),
    mapEntries: asNumber(record.mapEntries),
    created: asNumber(record.created),
    updated: asNumber(record.updated),
    removed: asNumber(record.removed),
    unchanged: asNumber(record.unchanged),
    problems,
    problemCount:
      typeof record.problemCount === "number"
        ? record.problemCount
        : problems.length,
    anchorSha: typeof record.anchorSha === "string" ? record.anchorSha : "",
    scannedAt,
  };

  return {
    kind: "scanned",
    report,
    problemDetails: problems
      .slice(0, MARKER_PROBLEM_PREVIEW_LIMIT)
      .map((problem) => problem.detail),
  };
}
