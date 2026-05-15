import { MatrixPageClient } from "./matrix-page-client";

interface MatrixPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Matrix view page — server component shell. Parses the projectId from
 * the route segment and delegates rendering to the client orchestrator,
 * which owns URL filter state + React Query data flow.
 */
export default async function MatrixPage({ params }: MatrixPageProps) {
  const { projectId: projectIdParam } = await params;
  const projectId = parseInt(projectIdParam, 10);
  if (Number.isNaN(projectId) || projectId <= 0) {
    return null;
  }
  return <MatrixPageClient projectId={projectId} />;
}
