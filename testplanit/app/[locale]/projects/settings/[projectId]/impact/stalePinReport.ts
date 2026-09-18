import type { StalePinCheckReport } from "~/lib/services/impact/stalePinCheck";
import { ISSUE_SCAN_STALE_MS } from "./issueScanReport";

export interface StalePinCheckRunning {
  startedAt: string | null;
  /** When the worker last wrote progress. */
  progressAt: string | null;
  checkedFiles: number;
  totalFiles: number;
  pins: number;
}

export type StalePinReportView =
  | { kind: "never" }
  | { kind: "running"; progress: StalePinCheckRunning }
  | { kind: "error"; error: string; checkedAt: string | null }
  | { kind: "checked"; report: StalePinCheckReport };

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * True when a check's running flag looks left behind: the worker that owned
 * it died or never knew the job, so nothing will clear it. The page then
 * lets the check be queued again rather than waiting on it.
 */
export function isStalePinCheckAbandoned(
  progress: StalePinCheckRunning,
  now: number = Date.now()
): boolean {
  const last = progress.progressAt ?? progress.startedAt;
  if (!last) return true;
  const at = Date.parse(last);
  if (!Number.isFinite(at)) return true;
  return now - at > ISSUE_SCAN_STALE_MS;
}

/**
 * Classifies the `stalePinReport` JSON stored on an IMPACT config. The
 * repo-cache worker writes `{ running: true, ... }` with progress while a
 * check reads files, `{ error, checkedAt }` when it failed, or the full
 * `StalePinCheckReport` when it ran.
 */
export function readStalePinReport(raw: unknown): StalePinReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const checkedAt =
    typeof record.checkedAt === "string" ? record.checkedAt : null;

  if (record.running === true) {
    return {
      kind: "running",
      progress: {
        startedAt:
          typeof record.startedAt === "string" ? record.startedAt : null,
        progressAt:
          typeof record.progressAt === "string" ? record.progressAt : null,
        checkedFiles: asNumber(record.checkedFiles),
        totalFiles: asNumber(record.totalFiles),
        pins: asNumber(record.pins),
      },
    };
  }

  if (typeof record.error === "string") {
    return { kind: "error", error: record.error, checkedAt };
  }

  if (checkedAt === null) {
    return { kind: "never" };
  }

  const byReason =
    record.byReason && typeof record.byReason === "object"
      ? (record.byReason as Record<string, unknown>)
      : {};
  return {
    kind: "checked",
    report: {
      checkedAt,
      checkedSha:
        typeof record.checkedSha === "string" ? record.checkedSha : "",
      pins: asNumber(record.pins),
      checked: asNumber(record.checked),
      stale: asNumber(record.stale),
      dismissed: asNumber(record.dismissed),
      managed: asNumber(record.managed),
      unreadableFiles: asNumber(record.unreadableFiles),
      byReason: {
        FILE_DELETED: asNumber(byReason.FILE_DELETED),
        SNIPPET_NOT_FOUND: asNumber(byReason.SNIPPET_NOT_FOUND),
        SYMBOL_NOT_FOUND: asNumber(byReason.SYMBOL_NOT_FOUND),
      },
    },
  };
}
