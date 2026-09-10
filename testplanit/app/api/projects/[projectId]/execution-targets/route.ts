import { NextResponse, type NextRequest } from "next/server";
import { ApplicationArea } from "~/zenstack/models";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { getServerAuthSession } from "~/server/auth";

/**
 * GET /api/projects/{projectId}/execution-targets
 * The sanitized target list (id, name, provider, default ref, enabled) for
 * anyone who can add/edit runs in the project — the same data the run page's
 * dialog gets from its server action, exposed for API tokens (CLI, MCP).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId: raw } = await params;
  const projectId = Number.parseInt(raw, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const session = await getServerAuthSession();
  const auth = await authenticateRequest(request, session);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (hasBearerToken(request)) {
    const limit = await checkApiRateLimit();
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
  }
  const allowed = await userCanAddEditArea(
    auth.user.userId,
    projectId,
    ApplicationArea.TestRuns,
    auth.user.access
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const targets = await baseDb.executionTarget.findMany({
    where: { projectId, isDeleted: false },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      provider: true,
      defaultRef: true,
      isEnabled: true,
    },
  });
  return NextResponse.json(
    { targets },
    { headers: { "Cache-Control": "no-store" } }
  );
}
