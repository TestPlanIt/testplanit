import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "~/lib/prisma";
import { buildIterationIssueBody } from "~/lib/services/iterationIssueBodyBuilder";
import { authOptions } from "~/server/auth";

/**
 * INT-05 — issue-body prefill endpoint.
 *
 * GET /api/repository/test-runs/[runId]/cases/[caseId]/iterations/[iterId]/issue-body
 *
 * Server-side composes the `{ title, description }` payload for the
 * "Create linked Issue" dialog on a failed iteration. The description is
 * a TipTap doc — the create-issue API route accepts the doc shape and the
 * three adapters (Jira/GitHub/Azure DevOps) render it natively (D-15).
 *
 * Sensitive parameter values are redacted per the CALLER's permission
 * (D-13). This is intentional: the user filing the issue should see what
 * they're authorized to see in the prefilled body. The adapter-side
 * webhook redaction in `submit-result` uses `viewerCanReadSensitive=false`
 * independently — the two paths do not share a flag.
 */

async function resolveCanReadSensitive(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!u) return false;
  if (u.access === "ADMIN") return true;
  const perms = u.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some(
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true,
      )
    : false;
}

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ runId: string; caseId: string; iterId: string }>;
  },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId, caseId, iterId } = await context.params;
  const iterationId = Number(iterId);
  const testRunCaseId = Number(caseId);
  const testRunId = Number(runId);

  if (!Number.isFinite(iterationId) || !Number.isFinite(testRunCaseId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  // Verify the iteration belongs to the run + case the URL claims — defense
  // in depth against IDOR. Read access is governed by the iteration's
  // existing ZenStack project-membership policy via getEnhancedDb usage
  // elsewhere; here we use raw prisma to scope the existence check.
  const iteration = await prisma.testRunCaseIteration.findFirst({
    where: {
      id: iterationId,
      testRunCaseId,
      isDeleted: false,
      testRunCase: {
        testRunId,
      },
    },
    select: { id: true },
  });
  if (!iteration) {
    return NextResponse.json({ error: "Iteration not found" }, { status: 404 });
  }

  const viewerCanReadSensitive = await resolveCanReadSensitive(session.user.id);

  try {
    const body = await buildIterationIssueBody({
      iterationId,
      viewerCanReadSensitive,
    });
    return NextResponse.json(body);
  } catch (err) {
    console.error("buildIterationIssueBody failed", err);
    return NextResponse.json(
      { error: "Failed to build issue body" },
      { status: 500 },
    );
  }
}
