/**
 * In-app path of a fired threshold subject (#651). Pure and client-safe:
 * the webhook payload, the bell and the email worker all link through it.
 */
export function subjectPath(
  subjectType:
    | "CASE"
    | "RUN"
    | "MILESTONE"
    | "SESSION"
    | "PROJECT"
    | "WEBHOOK"
    | "LLM_INTEGRATION"
    | string,
  projectId: number | null,
  subjectId: number,
  testRunId?: number | null
): string {
  // AI model integrations are administered system-wide; no project is
  // involved, so the path ignores it.
  if (subjectType === "LLM_INTEGRATION") return "/admin/llm";
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
