import { NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { getProjectCardStats } from "~/lib/services/projectCardStats";
import { getServerAuthSession } from "~/server/auth";
import { withRequestRouting } from "~/lib/db/requestRouting";

const MAX_PROJECTS = 500;

/**
 * Live figures for project cards: `{ stats: { [projectId]: ProjectCardStats } }`
 * for the requested projects the caller can read. Ids the caller cannot read,
 * or that do not exist, are left out.
 */
async function handlePOST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let projectIds: unknown;
  try {
    ({ projectIds } = (await request.json()) as { projectIds?: unknown });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  if (
    !Array.isArray(projectIds) ||
    projectIds.length > MAX_PROJECTS ||
    !projectIds.every((id) => Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "projectIds must be a list of project ids" },
      { status: 400 }
    );
  }
  if (projectIds.length === 0) {
    return NextResponse.json({ stats: {} });
  }

  try {
    const db = await getEnhancedDb(session);
    const readable = await db.projects.findMany({
      where: { id: { in: projectIds as number[] }, isDeleted: false },
      select: { id: true },
    });
    const stats = await getProjectCardStats(
      readable.map((project) => project.id),
      session.user.id
    );
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching project card stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch project card stats" },
      { status: 500 }
    );
  }
}

export const POST = withRequestRouting(handlePOST);
