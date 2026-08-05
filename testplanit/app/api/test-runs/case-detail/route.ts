import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getTestRunCaseDetail } from "~/lib/services/testRunCaseDetail";
import { authOptions } from "~/server/auth";

// Backs the test-run results panel's "load this case's full detail" fetch --
// see lib/services/testRunCaseDetail.ts for why this moved off the
// policy-enforced client hook (mean 10.6s / max 65s per call in prod).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caseIdParam = request.nextUrl.searchParams.get("caseId");
  const caseId = caseIdParam !== null ? Number(caseIdParam) : NaN;
  if (!Number.isFinite(caseId)) {
    return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  }
  const testRunIdParam = request.nextUrl.searchParams.get("testRunId");
  const testRunId =
    testRunIdParam && Number.isFinite(Number(testRunIdParam))
      ? Number(testRunIdParam)
      : undefined;

  const caseProject = await baseDb.repositoryCases.findUnique({
    where: { id: caseId },
    select: { projectId: true },
  });
  if (!caseProject) {
    // Matches findFirst's own `null` shape for "not found" -- lets the
    // client tell "doesn't exist / already deleted" apart from "forbidden".
    return NextResponse.json({ testcase: null });
  }

  const scope = await resolveViewerProjectScope(session.user.id);
  if (scope !== null && !scope.includes(caseProject.projectId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const testcase = await getTestRunCaseDetail(caseId, testRunId);
  return NextResponse.json({ testcase });
}
