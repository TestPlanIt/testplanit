/** BullMQ job id for an analysis (idempotent enqueue). */
export const impactJobId = (analysisId: number) => `impact-${analysisId}`;

/** Redis flag the worker polls between phases and LLM batches. */
export const impactCancelKey = (jobId: string) => `impact:cancel:${jobId}`;

/** Redis flag a running ticket scan polls between pages, rounds and commits. */
export const issueScanCancelKey = (configId: number) =>
  `impact:issue-scan:cancel:${configId}`;
