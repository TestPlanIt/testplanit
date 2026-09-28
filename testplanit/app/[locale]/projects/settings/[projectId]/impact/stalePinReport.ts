import type { StalePinCheckReport } from "~/lib/services/impact/stalePinCheck";
import type { RepoJobBehind } from "~/lib/services/impact/repoJobStatus";
import { readJobBehind } from "./issueScanReport";

export interface StalePinCheckRunning {
  startedAt: string | null;
  /** When the worker last wrote progress. */
  progressAt: string | null;
  checkedFiles: number;
  totalFiles: number;
  pins: number;
}

export interface StalePinCheckQueued {
  requestedAt: string | null;
  /** What the worker is busy with, when the queue said. */
  behind: RepoJobBehind | null;
}

export type StalePinReportView =
  | { kind: "never" }
  | { kind: "queued"; queued: StalePinCheckQueued }
  | {
      kind: "running";
      progress: StalePinCheckRunning;
      /** The queue holds the job, but progress stopped a while ago. */
      unresponsive: boolean;
    }
  /** The queue lost the job while the report still said running. */
  | { kind: "interrupted"; startedAt: string | null; checkedAt: string | null }
  | { kind: "cancelled"; checkedAt: string | null }
  | { kind: "error"; error: string; checkedAt: string | null }
  | { kind: "checked"; report: StalePinCheckReport };

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Classifies the `stalePinReport` JSON stored on an IMPACT config, as the
 * queue-backed status resolver hands it out: `{ queued: true }` while the
 * job waits, `{ running: true, ... }` with progress while a check reads
 * files, `{ interrupted: true }` when the queue lost the job,
 * `{ cancelled: true }`, `{ error, checkedAt }` when it failed, or the full
 * `StalePinCheckReport` when it ran.
 */
export function readStalePinReport(raw: unknown): StalePinReportView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "never" };
  }
  const record = raw as Record<string, unknown>;
  const checkedAt = asString(record.checkedAt);

  if (record.running === true) {
    return {
      kind: "running",
      unresponsive: record.unresponsive === true,
      progress: {
        startedAt: asString(record.startedAt),
        progressAt: asString(record.progressAt),
        checkedFiles: asNumber(record.checkedFiles),
        totalFiles: asNumber(record.totalFiles),
        pins: asNumber(record.pins),
      },
    };
  }
  if (record.queued === true) {
    return {
      kind: "queued",
      queued: {
        requestedAt: asString(record.requestedAt),
        behind: readJobBehind(record.behind),
      },
    };
  }
  if (record.interrupted === true) {
    return {
      kind: "interrupted",
      startedAt: asString(record.startedAt),
      checkedAt,
    };
  }
  if (record.cancelled === true) {
    return { kind: "cancelled", checkedAt };
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
      checkedSha: asString(record.checkedSha) ?? "",
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

/** A check is queued or running: the buttons wait and the page keeps polling. */
export function isStalePinCheckInFlight(view: StalePinReportView): boolean {
  return view.kind === "queued" || view.kind === "running";
}
