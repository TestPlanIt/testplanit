/**
 * Canonical iteration deep-link URL builder.
 *
 * The shape is fixed by D-09: every consumer of "drill into this iteration"
 * (matrix popover, TestRunLinkDisplay, INT-05 issue body, future report
 * builder presets) MUST produce the same URL. Centralizing the format here
 * keeps the surface honest.
 *
 * Format (byte-for-byte):
 *   /projects/runs/{projectId}/{runId}?iteration={N}&selectedCase={caseId}
 *
 * The pathname is hand-concatenated (numeric IDs do not need encoding) but
 * the query string is built via `URLSearchParams` so future fields (e.g.
 * `&tab=audit-log`) plug in via `.set()` instead of string concatenation.
 */
export interface BuildIterationDeepLinkInput {
  projectId: number;
  runId: number;
  /** 1-based iteration position (matches `iteration.rowIndex + 1`). */
  iterationNumber: number;
  /**
   * The RepositoryCases.id — drives the case-row preselection on landing.
   * The case table on the run drill-down sets `data-row-id` from
   * `row.original.id` (the RepositoryCases.id), and
   * `TestCasesSection.tsx` matches `?selectedCase=` against that. Passing
   * a TestRunCases.id here silently fails to preselect the row.
   */
  repositoryCaseId: number;
}

export function buildIterationDeepLink(
  input: BuildIterationDeepLinkInput
): string {
  const params = new URLSearchParams();
  params.set("iteration", String(input.iterationNumber));
  params.set("selectedCase", String(input.repositoryCaseId));
  return `/projects/runs/${input.projectId}/${input.runId}?${params.toString()}`;
}
