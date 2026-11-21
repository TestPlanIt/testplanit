export type QaseImportStatusValue =
  "QUEUED" | "RUNNING" | "READY" | "COMPLETED" | "FAILED" | "CANCELED";

export type QaseImportPhaseValue = "FETCHING" | "CONFIGURING" | "IMPORTING";

/** A Qase project as the Connect step lists it. */
export interface QaseProjectSummary {
  code: string;
  title: string;
  cases: number;
  suites: number;
  milestones: number;
  runs: number;
  defects: number;
}

/** Records fetched so far for one entity, across the selected projects. */
export interface QaseFetchProgressEntry {
  fetched: number;
  /** Null until Qase has reported the size of every selected project. */
  total: number | null;
  done: boolean;
}

export type QaseFetchProgress = Record<string, QaseFetchProgressEntry>;

export interface QaseImportJobPayload {
  id: string;
  status: QaseImportStatusValue;
  phase: QaseImportPhaseValue | null;
  statusMessage: string | null;
  error: string | null;
  apiHost: string;
  projects: QaseProjectSummary[];
  fetchProgress: QaseFetchProgress;
  currentEntity: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  durationMs: number | null;
}

export type QaseImportMode = "fetch";
