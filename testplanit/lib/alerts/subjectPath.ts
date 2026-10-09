/**
 * In-app path of a fired threshold subject (#651). Pure and client-safe:
 * the webhook payload, the bell and the email worker all link through it.
 */
export function subjectPath(
  subjectType:
    "CASE" | "RUN" | "MILESTONE" | "SESSION" | "PROJECT" | "WEBHOOK" | string,
  projectId: number,
  subjectId: number,
  testRunId?: number | null
): string {
  switch (subjectType) {
    case "CASE":
      return testRunId
        ? `/projects/runs/${projectId}/${testRunId}?selectedCase=${subjectId}`
        : `/projects/repository/${projectId}/${subjectId}`;
    case "RUN":
      return `/projects/runs/${projectId}/${subjectId}`;
    case "MILESTONE":
      return `/projects/milestones/${projectId}/${subjectId}`;
    case "SESSION":
      return `/projects/sessions/${projectId}/${subjectId}`;
    case "WEBHOOK":
      return `/projects/settings/${projectId}/webhooks`;
    case "PROJECT":
    default:
      return `/projects/overview/${projectId}`;
  }
}
