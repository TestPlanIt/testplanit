import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

// Tags used within a single project, with counts scoped to that project.
//
// Driven entirely off baseDb (no ZenStack policy plugin) after a single
// project-access check, instead of the policy-enforced client hook this
// replaced. That hook's filtered `_count`/`some` relation filters made
// ZenStack re-inline the raw `Projects` `@@allow('read', ...)` ladder as a
// correlated per-row subquery at every relation-filter site -- 120 of them
// for this exact shape (3 relations x 2 sites), 78s mean execution time.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isFinite(projectId)) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  const scope = await resolveViewerProjectScope(session.user.id);
  if (scope !== null && !scope.includes(projectId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tags = await baseDb.tags.findMany({
    where: {
      isDeleted: false,
      OR: [
        {
          caseTags: {
            some: {
              case: { isDeleted: false, isArchived: false, projectId },
            },
          },
        },
        { testRuns: { some: { projectId, isDeleted: false } } },
        { sessions: { some: { projectId, isDeleted: false } } },
      ],
    },
    select: {
      id: true,
      name: true,
      caseTags: {
        where: { case: { isDeleted: false, isArchived: false, projectId } },
        select: { caseId: true },
      },
      testRuns: {
        where: { projectId, isDeleted: false },
        select: { id: true },
      },
      sessions: {
        where: { projectId, isDeleted: false },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  const result = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    count: tag.caseTags.length + tag.testRuns.length + tag.sessions.length,
  }));

  return NextResponse.json({ tags: result });
}
