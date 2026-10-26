import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { resolvePriorityWeights } from "~/lib/schemas/riskPriorityWeights";
import { getProjectPriorityUsage } from "~/lib/services/risk/priorities";
import { authOptions } from "~/server/auth";

type RouteContext = { params: Promise<{ projectId: string }> };

/**
 * GET: the priority vocabulary in use across the project's linked issues,
 * merged with the configured mapping — rows the admin maps on the Risk
 * Scoring settings page. Mapped-but-no-longer-used names come back with
 * count 0 so they stay editable.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { projectId: raw } = await context.params;
  const projectId = Number(raw);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const admin = await authorizeProjectAdminForProject(session, projectId);
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error ?? "Forbidden" },
      { status: admin.status }
    );
  }
  try {
    const project = await baseDb.projects.findUnique({
      where: { id: projectId },
      select: { riskPriorityWeights: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const mapping = resolvePriorityWeights(project.riskPriorityWeights);
    const usage = await getProjectPriorityUsage(baseDb, projectId);
    const seen = new Set(usage.map((row) => row.value));
    const priorities = usage.map((row) => ({
      value: row.value,
      count: row.count,
      weight: mapping.get(row.value) ?? null,
    }));
    for (const [value, weight] of mapping) {
      if (!seen.has(value)) priorities.push({ value, count: 0, weight });
    }
    return NextResponse.json({ priorities });
  } catch (error) {
    console.error("[risk-score] priority usage request failed:", error);
    return NextResponse.json(
      { error: "Failed to load priorities" },
      { status: 500 }
    );
  }
}
