/**
 * GET /api/admin/audit-logs/filters?type=actions|entityTypes|projects|users
 *
 * Option sources for the admin audit-log filter pickers.
 *
 * These reads deliberately sit on a route rather than on a Server Action.
 * Next's app router funnels every Server Action through a single-slot queue
 * (`actionQueue.pending` in app-router-instance), so actions run strictly one
 * at a time per client: opening the user picker — the most expensive of the
 * four, since distinct actors are enumerated across the whole audit table —
 * held every other picker's fetch behind it, leaving them spinning until the
 * page was reloaded. As plain requests the four pickers load independently and
 * in parallel.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getAuditLogActions } from "~/lib/services/auditLog/getAuditLogActions";
import { getAuditLogEntityTypes } from "~/lib/services/auditLog/getAuditLogEntityTypes";
import { getAuditLogProjects } from "~/lib/services/auditLog/getAuditLogProjects";
import { searchAuditLogUsers } from "~/lib/services/auditLog/searchAuditLogUsers";
import { authOptions } from "~/server/auth";

const DEFAULT_PAGE_SIZE = 25;

/** Parse a non-negative integer query param, falling back when absent or junk. */
function intParam(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  // Cross-user audit data — matches the AuditLog model's
  // `@@allow('read', access == 'ADMIN')`.
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  try {
    switch (type) {
      case "actions":
        return NextResponse.json(await getAuditLogActions());
      case "entityTypes":
        return NextResponse.json(await getAuditLogEntityTypes());
      case "projects":
        return NextResponse.json(await getAuditLogProjects());
      case "users":
        return NextResponse.json(
          await searchAuditLogUsers(
            searchParams.get("q") ?? "",
            intParam(searchParams.get("page"), 0),
            intParam(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE)
          )
        );
      default:
        return NextResponse.json(
          { error: "Unknown filter type" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error loading audit log filter options:", error);
    return NextResponse.json(
      { error: "Failed to load filter options" },
      { status: 500 }
    );
  }
}
