/**
 * GET /api/projects/[projectId]/audit-log-users?q=&page=&pageSize=
 *
 * Distinct actors in one project's audit log, driving that tab's user filter.
 *
 * A route rather than a Server Action for the same reason as the admin filter
 * endpoint: Server Actions run one at a time per client, so a slow actor search
 * stalls every other action the page issues until a reload.
 *
 * Authorization lives in `searchProjectAuditLogUsers`, which allows system
 * admins and project admins assigned to the project and returns an empty page
 * otherwise — replicating the AuditLog read policy. Duplicating the assignment
 * lookup here would only double the query, so this checks authentication and
 * delegates the rest.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { searchProjectAuditLogUsers } from "~/lib/services/auditLog/searchProjectAuditLogUsers";
import { authOptions } from "~/server/auth";

const DEFAULT_PAGE_SIZE = 25;

/** Parse a non-negative integer query param, falling back when absent or junk. */
function intParam(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const parsedProjectId = Number.parseInt(projectId, 10);
  if (!Number.isInteger(parsedProjectId)) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json(
      await searchProjectAuditLogUsers(
        parsedProjectId,
        searchParams.get("q") ?? "",
        intParam(searchParams.get("page"), 0),
        intParam(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE)
      )
    );
  } catch (error) {
    console.error("Error loading project audit log users:", error);
    return NextResponse.json(
      { error: "Failed to load audit log users" },
      { status: 500 }
    );
  }
}
