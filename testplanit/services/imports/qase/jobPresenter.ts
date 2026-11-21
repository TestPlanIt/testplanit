import type { QaseImportJob } from "~/zenstack/models";
import type { QaseClient } from "./qaseClient";
import type {
  QaseFetchProgress,
  QaseImportJobPayload,
  QaseProjectSummary,
} from "./types";

export const JOB_PROCESS_QASE_IMPORT = "process-qase-import";

interface QaseProjectRecord {
  code?: unknown;
  title?: unknown;
  counts?: {
    cases?: unknown;
    suites?: unknown;
    milestones?: unknown;
    runs?: { total?: unknown } | null;
    defects?: { total?: unknown } | null;
  } | null;
}

const toCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function toProjectSummary(record: QaseProjectRecord): QaseProjectSummary {
  return {
    code: String(record.code ?? ""),
    title: String(record.title ?? record.code ?? ""),
    cases: toCount(record.counts?.cases),
    suites: toCount(record.counts?.suites),
    milestones: toCount(record.counts?.milestones),
    runs: toCount(record.counts?.runs?.total),
    defects: toCount(record.counts?.defects?.total),
  };
}

/** Every project the token can read, in the order Qase lists them. */
export async function listQaseProjects(
  client: QaseClient
): Promise<QaseProjectSummary[]> {
  const projects: QaseProjectSummary[] = [];
  for await (const page of client.pages<QaseProjectRecord>("project")) {
    for (const record of page.entities) {
      const summary = toProjectSummary(record);
      if (summary.code) {
        projects.push(summary);
      }
    }
  }
  return projects;
}

const toISO = (value?: Date | null) => (value ? value.toISOString() : null);

/** The job as the admin UI receives it. Never includes the API token. */
export function serializeQaseImportJob(
  job: Omit<QaseImportJob, "apiToken">
): QaseImportJobPayload {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase ?? null,
    statusMessage: job.statusMessage ?? null,
    error: job.error ?? null,
    apiHost: job.apiHost,
    projects: Array.isArray(job.projects)
      ? (job.projects as unknown as QaseProjectSummary[])
      : [],
    fetchProgress:
      job.fetchProgress && typeof job.fetchProgress === "object"
        ? (job.fetchProgress as unknown as QaseFetchProgress)
        : {},
    currentEntity: job.currentEntity ?? null,
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt.toISOString(),
    startedAt: toISO(job.startedAt),
    completedAt: toISO(job.completedAt),
    canceledAt: toISO(job.canceledAt),
    durationMs: job.durationMs ?? null,
  };
}
