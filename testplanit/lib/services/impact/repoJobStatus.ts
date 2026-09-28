import type { Job, Queue } from "bullmq";
import {
  JOB_CHECK_STALE_PINS,
  JOB_REFRESH_EXPIRED_CACHES,
  JOB_REFRESH_SINGLE_REPO_CACHE,
  JOB_SCAN_REPO_ISSUES,
} from "~/lib/queueNames";
import { findRepoJob, isLiveJobState, type RepoJobKind } from "./repoJobs";

/**
 * A running job that has not written progress for this long is reported as
 * not responding. It is still running: only the queue says otherwise.
 */
export const REPO_JOB_UNRESPONSIVE_MS = 30 * 60 * 1000;

export type RepoJobBehindKind = RepoJobKind | "sweep" | "other";

/** What the worker is busy with while a job waits. */
export interface RepoJobBehind {
  kind: RepoJobBehindKind;
  configId: number | null;
}

export type RepoJobStatus =
  | {
      status: "running";
      jobId: string;
      /** No progress written for REPO_JOB_UNRESPONSIVE_MS. */
      unresponsive: boolean;
    }
  | { status: "queued"; jobId: string; behind: RepoJobBehind | null }
  /** The saved report says running or queued, but the queue holds no job. */
  | { status: "interrupted" }
  /** No job; the saved report is the whole story. */
  | { status: "idle" };

/** The columns the resolver reads on a ProjectCodeRepositoryConfig row. */
export interface RepoStatusRow {
  id: number;
  issueScanReport?: unknown;
  stalePinReport?: unknown;
  cacheStatus?: string | null;
}

/** What the nightly sweep records as it moves from one connection to the next. */
export interface SweepProgress {
  configId: number;
  /** Epoch ms of the move; the sweep's heartbeat for that connection. */
  at: number;
}

export function readSweepProgress(job: {
  progress?: unknown;
}): SweepProgress | null {
  const progress = job.progress;
  if (!progress || typeof progress !== "object") return null;
  const configId = Number((progress as { configId?: unknown }).configId);
  if (!Number.isFinite(configId)) return null;
  const at = Number((progress as { at?: unknown }).at);
  return { configId, at: Number.isFinite(at) ? at : 0 };
}

type QueueReader = Pick<Queue, "getJob" | "getActive">;

function jobTenant(job: Job): string | null {
  const tenantId = (job.data as { tenantId?: unknown } | undefined)?.tenantId;
  return typeof tenantId === "string" && tenantId ? tenantId : null;
}

function jobConfigId(job: Job): number | null {
  const configId = Number(
    (job.data as { configId?: unknown } | undefined)?.configId
  );
  return Number.isFinite(configId) ? configId : null;
}

function behindKind(job: Job): RepoJobBehindKind {
  switch (job.name) {
    case JOB_REFRESH_EXPIRED_CACHES:
      return "sweep";
    case JOB_REFRESH_SINGLE_REPO_CACHE:
      return "refresh-cache";
    case JOB_SCAN_REPO_ISSUES:
      return "scan-issues";
    case JOB_CHECK_STALE_PINS:
      return "stale-pins";
    default:
      return "other";
  }
}

/**
 * One tenant's view of the repo-cache queue for one resolution pass. The
 * active list is read once, however many rows and kinds are resolved.
 */
export class RepoQueueView {
  private active: Promise<Job[]> | null = null;

  constructor(
    private readonly queue: QueueReader,
    private readonly tenantId?: string | null
  ) {}

  own(kind: RepoJobKind, configId: number) {
    return findRepoJob(this.queue, kind, configId, this.tenantId);
  }

  activeJobs(): Promise<Job[]> {
    this.active ??= this.queue
      .getActive(0, 50)
      .then((jobs) =>
        jobs.filter((job) => jobTenant(job) === (this.tenantId ?? null))
      );
    return this.active;
  }

  /**
   * The active job that owns a connection's running flag when the
   * connection's own job of the kind is not there: a manual cache refresh
   * (which ends with the ticket scan) or the nightly sweep while it is on
   * this connection.
   */
  async otherOwner(kind: RepoJobKind, configId: number): Promise<Job | null> {
    if (kind === "stale-pins") return null;
    const active = await this.activeJobs();
    for (const job of active) {
      if (
        kind === "scan-issues" &&
        job.name === JOB_REFRESH_SINGLE_REPO_CACHE &&
        jobConfigId(job) === configId
      ) {
        return job;
      }
      if (
        job.name === JOB_REFRESH_EXPIRED_CACHES &&
        readSweepProgress(job)?.configId === configId
      ) {
        return job;
      }
    }
    return null;
  }

  /** What the worker is on right now, for a job that waits behind it. */
  async busy(): Promise<RepoJobBehind | null> {
    const [job] = await this.activeJobs();
    if (!job) return null;
    const kind = behindKind(job);
    return {
      kind,
      configId:
        kind === "sweep"
          ? (readSweepProgress(job)?.configId ?? null)
          : jobConfigId(job),
    };
  }
}

function reportRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function reportFlag(raw: unknown): "running" | "queued" | null {
  const record = reportRecord(raw);
  if (!record) return null;
  if (record.running === true) return "running";
  if (record.queued === true) return "queued";
  return null;
}

/** What the saved columns claim about a kind, before the queue is asked. */
export function savedRepoJobFlag(
  kind: RepoJobKind,
  row: RepoStatusRow
): "running" | "queued" | null {
  switch (kind) {
    case "scan-issues":
      return reportFlag(row.issueScanReport);
    case "stale-pins":
      return reportFlag(row.stalePinReport);
    case "refresh-cache":
      return row.cacheStatus === "pending" ? "running" : null;
  }
}

function reportHeartbeat(kind: RepoJobKind, row: RepoStatusRow): number {
  const record =
    kind === "scan-issues"
      ? reportRecord(row.issueScanReport)
      : kind === "stale-pins"
        ? reportRecord(row.stalePinReport)
        : null;
  if (!record) return 0;
  for (const key of ["progressAt", "startedAt"]) {
    const value = record[key];
    if (typeof value === "string") {
      const at = Date.parse(value);
      if (Number.isFinite(at)) return at;
    }
  }
  return 0;
}

function runningStatus(
  job: Job,
  kind: RepoJobKind,
  row: RepoStatusRow,
  now: number
): RepoJobStatus {
  const sweepAt =
    job.name === JOB_REFRESH_EXPIRED_CACHES
      ? (readSweepProgress(job)?.at ?? 0)
      : 0;
  const last = Math.max(
    reportHeartbeat(kind, row),
    job.processedOn ?? 0,
    sweepAt
  );
  return {
    status: "running",
    jobId: String(job.id ?? ""),
    unresponsive: last > 0 && now - last > REPO_JOB_UNRESPONSIVE_MS,
  };
}

/**
 * Where one connection's job of a kind stands, from the queue first and the
 * saved report second. The queue says whether a job exists and whether it
 * is running or waiting; the saved report only supplies the heartbeat, and
 * a running flag the queue cannot account for means the job was lost.
 */
export async function resolveRepoJobStatus(
  view: RepoQueueView,
  kind: RepoJobKind,
  row: RepoStatusRow,
  now: number = Date.now()
): Promise<RepoJobStatus> {
  const own = await view.own(kind, row.id);
  if (own && own.state === "active") {
    return runningStatus(own.job, kind, row, now);
  }
  if (own && isLiveJobState(own.state)) {
    return {
      status: "queued",
      jobId: String(own.job.id ?? ""),
      behind: await view.busy(),
    };
  }
  const saved = savedRepoJobFlag(kind, row);
  if (saved === "running") {
    const owner = await view.otherOwner(kind, row.id);
    if (owner) return runningStatus(owner, kind, row, now);
    return { status: "interrupted" };
  }
  if (saved === "queued") return { status: "interrupted" };
  return { status: "idle" };
}

/** Column writes that make a resolved status the saved one. */
export type RepoStatusPersist = Partial<
  Pick<RepoStatusRow, "issueScanReport" | "stalePinReport" | "cacheStatus">
>;

function withoutFlags(raw: unknown, drop: string[]): Record<string, unknown> {
  const record = { ...(reportRecord(raw) ?? {}) };
  for (const key of drop) delete record[key];
  return record;
}

/**
 * Rewrite one kind's saved columns on a row so they say what the queue
 * says. Returns the columns to persist when the row itself must change:
 * a lost job is written as interrupted so the leftover clears on first
 * read; queued and running are not written back (the worker owns those).
 */
export function applyRepoJobStatus(
  kind: RepoJobKind,
  row: RepoStatusRow,
  status: RepoJobStatus,
  nowIso: string = new Date().toISOString()
): RepoStatusPersist | null {
  if (status.status === "idle") return null;
  if (kind === "refresh-cache") {
    if (status.status === "queued") row.cacheStatus = "queued";
    if (status.status === "interrupted") {
      row.cacheStatus = "interrupted";
      return { cacheStatus: "interrupted" };
    }
    return null;
  }
  const column = kind === "scan-issues" ? "issueScanReport" : "stalePinReport";
  const saved = row[column];
  switch (status.status) {
    case "running":
      row[column] = {
        ...withoutFlags(saved, ["queued", "behind", "unresponsive"]),
        running: true,
        unresponsive: status.unresponsive,
      };
      return null;
    case "queued":
      row[column] = {
        ...withoutFlags(saved, ["running", "unresponsive", "behind"]),
        queued: true,
        behind: status.behind,
      };
      return null;
    case "interrupted": {
      const record = reportRecord(saved) ?? {};
      const startedAt =
        typeof record.startedAt === "string"
          ? record.startedAt
          : typeof record.requestedAt === "string"
            ? record.requestedAt
            : null;
      const report =
        kind === "scan-issues"
          ? {
              interrupted: true,
              full: record.full === true,
              startedAt,
              scannedAt: nowIso,
            }
          : { interrupted: true, startedAt, checkedAt: nowIso };
      row[column] = report;
      return { [column]: report };
    }
  }
}

export const REPO_JOB_KINDS: readonly RepoJobKind[] = [
  "scan-issues",
  "stale-pins",
  "refresh-cache",
];

export interface AnnotateRepoJobStatusDeps {
  queue: QueueReader | null | undefined;
  tenantId?: string | null;
  /** Writes the columns of a row whose saved flag the queue disowned. */
  persist?: (configId: number, data: RepoStatusPersist) => Promise<void>;
  now?: () => number;
}

/**
 * Make every row say what the queue says about its jobs. Rows whose saved
 * columns claim nothing is in flight cost no queue call; the rest are
 * resolved against one read of the active list and a `getJob` per claim.
 * A row the queue disowns is rewritten as interrupted and persisted. The
 * rows are mutated in place; the count of interrupted claims is returned.
 */
export async function annotateRepoJobStatus(
  rows: RepoStatusRow[],
  deps: AnnotateRepoJobStatusDeps
): Promise<number> {
  if (!deps.queue) return 0;
  const claims = rows.filter(
    (row) =>
      typeof row?.id === "number" &&
      REPO_JOB_KINDS.some((kind) => savedRepoJobFlag(kind, row) !== null)
  );
  if (claims.length === 0) return 0;
  const view = new RepoQueueView(deps.queue, deps.tenantId);
  const now = deps.now ?? Date.now;
  let interrupted = 0;
  for (const row of claims) {
    const persist: RepoStatusPersist = {};
    for (const kind of REPO_JOB_KINDS) {
      if (savedRepoJobFlag(kind, row) === null) continue;
      const status = await resolveRepoJobStatus(view, kind, row, now());
      const writes = applyRepoJobStatus(
        kind,
        row,
        status,
        new Date(now()).toISOString()
      );
      if (writes) {
        interrupted++;
        Object.assign(persist, writes);
      }
    }
    if (deps.persist && Object.keys(persist).length > 0) {
      await deps.persist(row.id, persist);
    }
  }
  return interrupted;
}

type RepoStatusDb = {
  projectCodeRepositoryConfig: {
    findMany: (args: unknown) => Promise<RepoStatusRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Worker-start cleanup: every connection whose saved columns claim a job
 * the queue does not hold is marked interrupted. Cheap, and it makes the
 * saved columns truthful even for readers that never ask the queue. Jobs
 * the queue still holds are left alone, whether waiting or active.
 */
export async function markInterruptedRepoJobs(
  db: RepoStatusDb,
  queue: QueueReader,
  tenantId?: string | null
): Promise<number> {
  const rows = await db.projectCodeRepositoryConfig.findMany({
    select: {
      id: true,
      issueScanReport: true,
      stalePinReport: true,
      cacheStatus: true,
    },
  });
  return annotateRepoJobStatus(rows, {
    queue,
    tenantId,
    persist: async (configId, data) => {
      await db.projectCodeRepositoryConfig.update({
        where: { id: configId },
        data,
      });
    },
  });
}
