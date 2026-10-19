import type { MultiTenantJobData } from "~/lib/multiTenantDb";

export interface TriageRunJobData extends MultiTenantJobData {
  testRunId: number;
  projectId: number;
  /** Who gets LLM usage attributed; falls back to the run's creator. */
  userId?: string;
}

export interface TriageBackfillJobData extends MultiTenantJobData {
  projectId: number;
  userId: string;
}

export interface ClassifySignaturesJobData extends MultiTenantJobData {
  projectId: number;
  signatureIds: number[];
  userId: string;
}

export type FailureTriageJobData =
  TriageRunJobData | TriageBackfillJobData | ClassifySignaturesJobData;
