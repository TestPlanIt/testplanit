import { NextRequest, NextResponse } from "next/server";
import {
  authenticateForgeWrite,
  forgeUserHasProjectAccess,
  FORGE_CORS_HEADERS,
  type ForgeUser,
} from "@/lib/services/forge-jira-auth";
import {
  getProjectReadiness,
  listGenerationProjects,
  listProjectFolders,
  listProjectTemplates,
  suggestFolderForIssue,
  type GenerationProject,
} from "@/lib/services/jira-panel-generation";

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
        },
        { headers: FORGE_CORS_HEADERS }
      );
    }

    // Resolve the selected project: explicit param (if accessible) → the
    // issue's mapped project → first accessible project.
    const requestedId = projectIdParam ? Number(projectIdParam) : NaN;
    const selected =
      (Number.isFinite(requestedId) &&
        projects.find((p) => p.id === requestedId)) ||
      projects.find((p) => p.isDefaultForIssue) ||
      projects[0];

    const [templates, readiness, folders, suggestedFolderId] =
      await Promise.all([
        listProjectTemplates(selected.id),
        getProjectReadiness(selected.id),
        listProjectFolders(selected.id),
        suggestFolderForIssue(selected.id, { issueKey, issueId }),
      ]);

    return NextResponse.json(
      {
        projects,
        selectedProjectId: selected.id,
        templates,
        readiness,
        folders,
        suggestedFolderId,
        issueKey,
      },
      { headers: FORGE_CORS_HEADERS }
    );
  } catch (error) {
    console.error(
      "Error in GET /api/integrations/jira/generate-context:",
      error
    );
    return NextResponse.json(
      { error: "Failed to load generation context" },
      { status: 500, headers: FORGE_CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}
