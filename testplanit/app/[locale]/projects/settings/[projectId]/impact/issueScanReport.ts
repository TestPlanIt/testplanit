import type { IssueScanReport } from "~/lib/services/impact/issueScan";

export type IssueScanReportView =
  | { kind: "never" }
  | { kind: "error"; error: string; scannedAt: string | null }
  | { kind: "scanned"; report: IssueScanReport };

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Classifies the `issueScanReport` JSON stored on an IMPACT config. The
 * cache-refresh worker writes `{ error, scannedAt }` when the scan failed, or
 * the full `IssueScanReport` when it ran.
 */
export function readIssueScanReport(raw: unknown): IssueScanReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const scannedAt =
    typeof record.scannedAt === "string" ? record.scannedAt : null;

  if (typeof record.error === "string") {
    return { kind: "error", error: record.error, scannedAt };
  }
  if (scannedAt === null) {
    return { kind: "never" };
  }

  return {
    kind: "scanned",
    report: {
      scannedCommits: asNumber(record.scannedCommits),
      matchedCommits: asNumber(record.matchedCommits),
      skippedLargeCommits: asNumber(record.skippedLargeCommits),
      issues: asNumber(record.issues),
      created: asNumber(record.created),
      updated: asNumber(record.updated),
      removed: asNumber(record.removed),
      unchanged: asNumber(record.unchanged),
      fetchCapped: record.fetchCapped === true,
      truncated: record.truncated === true,
      scannedAt,
    },
  };
}
