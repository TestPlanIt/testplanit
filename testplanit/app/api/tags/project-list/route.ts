import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

// Full tag list for a project's Tags page, with per-relation counts scoped to
// that project.
//
// Driven entirely off baseDb (no ZenStack policy plugin) after a single
// project-access check, instead of the policy-enforced client hooks this
// replaced. Those hooks' filtered `_count`/`some` relation filters make
// ZenStack re-inline the raw `Projects` `@@allow('read', ...)` ladder as a
// correlated per-row subquery at every relation-filter site (see
// ../for-project/route.ts for the same shape on the project overview).
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
        { caseTags: { some: { case: { projectId, isDeleted: false } } } },
        { testRuns: { some: { projectId, isDeleted: false } } },
        { sessions: { some: { projectId, isDeleted: false } } },
      ],
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          caseTags: { where: { case: { projectId, isDeleted: false } } },
          testRuns: { where: { projectId, isDeleted: false } },
          sessions: { where: { projectId, isDeleted: false } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    casesCount: tag._count.caseTags,
    sessionsCount: tag._count.sessions,
    runsCount: tag._count.testRuns,
  }));

  return NextResponse.json({ tags: result });
}
