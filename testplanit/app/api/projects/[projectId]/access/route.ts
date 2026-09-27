/**
 * GET /api/projects/[projectId]/access
 *
 * Every user who can open the project, with their effective role. Backs the
 * read-only Access page under Project → Settings.
 *
 * A route rather than a Server Action because the page fetches it for
 * display: Server Actions run one at a time per client and would queue
 * behind any other action the page issues.
 *
 * Callers must hold project-admin authority on the project, the same bar the
 * rest of the settings pages gate on (`authorizeProjectAdminForProject`).
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getProjectAccessRoster } from "~/lib/services/projectAccessRoster";
import { authOptions } from "~/server/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const parsedProjectId = Number.parseInt(projectId, 10);
  if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const authorization = await authorizeProjectAdminForProject(
    session,
    parsedProjectId
  );
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status }
    );
  }

  try {
    return NextResponse.json({
      users: await getProjectAccessRoster(parsedProjectId),
    });
  } catch (error) {
    console.error("Error loading project access:", error);
    return NextResponse.json(
      { error: "Failed to load project access" },
      { status: 500 }
    );
  }
}
