/**
 * In-app path of a fired alert subject (#651). Pure and client-safe:
 * the webhook payload, the bell and the email worker all link through it.
 * System subjects (no project) link into Administration; a repository
 * connection links to the project settings page that owns it, which the
 * event's details name.
 */
export interface SubjectPathExtras {
  subjectRef?: string | null;
  details?: Record<string, unknown> | null;
}

export function subjectPath(
  subjectType:
    | "CASE"
    | "RUN"
    | "MILESTONE"
    | "SESSION"
    | "PROJECT"
    | "WEBHOOK"
    | "LLM_INTEGRATION"
    | "CODE_REPOSITORY"
    | "INTEGRATION"
    | "QUEUE"
    | "SYSTEM"
    | string,
  projectId: number | null,
  subjectId: number,
  testRunId?: number | null,
  extras: SubjectPathExtras = {}
): string {
  switch (subjectType) {
    case "LLM_INTEGRATION":
      return "/admin/llm";
    case "CODE_REPOSITORY": {
      const owner = Number(extras.details?.projectId);
      if (Number.isFinite(owner) && owner > 0) {
        const page =
          extras.details?.purpose === "IMPACT" ? "impact" : "quickscript";
        return `/projects/settings/${owner}/${page}`;
      }
      return "/admin/code-repositories";
    }
    case "INTEGRATION":
      return "/admin/integrations";
    case "QUEUE":
      return "/admin/queues";
    case "SYSTEM":
      switch (extras.subjectRef) {
        case "audit":
          return "/admin/audit-logs";
        case "lockouts":
          return "/admin/users";
        case "automated-results":
          return "/admin/reports";
        default:
          return "/admin";
      }
    default:
      break;
  }
  if (projectId == null) return "/admin";
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

/** Subject kinds that belong to the installation rather than a project. */
export function isSystemSubjectType(subjectType: string | undefined): boolean {
  return (
    subjectType === "LLM_INTEGRATION" ||
    subjectType === "CODE_REPOSITORY" ||
    subjectType === "INTEGRATION" ||
    subjectType === "QUEUE" ||
    subjectType === "SYSTEM"
  );
}
