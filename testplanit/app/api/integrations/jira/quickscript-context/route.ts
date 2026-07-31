import { NextRequest, NextResponse } from "next/server";
import {
  authenticateForgeWrite,
  forgeUserHasProjectAccess,
  FORGE_CORS_HEADERS,
  type ForgeUser,
} from "@/lib/services/forge-jira-auth";
import {
  listGenerationProjects,
  type GenerationProject,
} from "@/lib/services/jira-panel-generation";
import {
  listIssueLinkedCases,
  listProjectExportTemplates,
} from "@/lib/services/jira-panel-quickscript";
import { getQuickScriptReadiness } from "@/lib/services/quickscript-generation";

/** Derive the Jira project key ("PROJ") from an issue key ("PROJ-123"). */
function projectKeyFromIssueKey(issueKey: string | null): string | null {
  if (!issueKey) return null;
  const dash = issueKey.lastIndexOf("-");
  return dash > 0 ? issueKey.slice(0, dash) : issueKey;
}

async function accessibleProjects(
  user: ForgeUser,
  projects: GenerationProject[]
): Promise<GenerationProject[]> {
  const checks = await Promise.all(
    projects.map((p) => forgeUserHasProjectAccess(user, p.id))
  );
  return projects.filter((_, i) => checks[i]);
}

/**
 * Bootstrap context for the Jira panel's "Generate QuickScript" flow: the
 * projects this integration connects to (that the mapped user can access, each
 * with its count of cases linked to this issue), the selected project's export
 * templates + QuickScript readiness, and the test cases already linked to the
 * issue (the source set the panel generates from).
 *
 * A Jira project maps to many TestPlanIt projects by design, but a case belongs
 * to exactly one — so the project holding the issue's cases is what the flow
 * needs, and the Jira-key mapping alone can't identify it. Selection therefore
 * looks at where the linked cases actually are before falling back to the
 * mapping.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const issueKey = searchParams.get("issueKey");
  const issueId = searchParams.get("issueId");
  const projectIdParam = searchParams.get("projectId");

  const auth = await authenticateForgeWrite(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: FORGE_CORS_HEADERS }
    );
  }

  try {
    const all = await listGenerationProjects(
      auth.integrationId,
      projectKeyFromIssueKey(issueKey)
    );
    const projects = await accessibleProjects(auth.user, all);

    if (projects.length === 0) {
      return NextResponse.json(
        {
          projects: [],
          selectedProjectId: null,
          templates: [],
          readiness: null,
          linkedCases: [],
          issueKey,
        },
        { headers: FORGE_CORS_HEADERS }
      );
    }

    // One lookup across every accessible project — the issue's cases can live
    // in any of them, and the Jira-key mapping doesn't say which.
    const allLinkedCases = await listIssueLinkedCases(
      projects.map((p) => p.id),
      { issueKey, issueId }
    );

    const countByProject = new Map<number, number>();
    for (const c of allLinkedCases) {
      countByProject.set(c.projectId, (countByProject.get(c.projectId) ?? 0) + 1);
    }
    const withCounts = projects.map((p) => ({
      ...p,
      linkedCaseCount: countByProject.get(p.id) ?? 0,
    }));

    // Selected project: explicit param (if accessible) → the project holding
    // the most cases linked to this issue, preferring the Jira-key-mapped one
    // on a tie → the issue's mapped project → first accessible project.
    // `projects` is already sorted mapped-first then by name, so a stable
    // max-by-count keeps that as the tiebreak.
    const requestedId = projectIdParam ? Number(projectIdParam) : NaN;
    const bestByLinkedCases = withCounts.reduce<
      (typeof withCounts)[number] | null
    >(
      (best, p) =>
        p.linkedCaseCount > 0 && (!best || p.linkedCaseCount > best.linkedCaseCount)
          ? p
          : best,
      null
    );
    const selected =
      (Number.isFinite(requestedId) &&
        withCounts.find((p) => p.id === requestedId)) ||
      bestByLinkedCases ||
      withCounts.find((p) => p.isDefaultForIssue) ||
      withCounts[0];

    const [templates, readiness] = await Promise.all([
      listProjectExportTemplates(selected.id),
      getQuickScriptReadiness(selected.id),
    ]);

    return NextResponse.json(
      {
        projects: withCounts,
        selectedProjectId: selected.id,
        templates,
        readiness,
        linkedCases: allLinkedCases.filter((c) => c.projectId === selected.id),
        issueKey,
      },
      { headers: FORGE_CORS_HEADERS }
    );
  } catch (error) {
    console.error(
      "Error in GET /api/integrations/jira/quickscript-context:",
      error
    );
    return NextResponse.json(
      { error: "Failed to load QuickScript context" },
      { status: 500, headers: FORGE_CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}
