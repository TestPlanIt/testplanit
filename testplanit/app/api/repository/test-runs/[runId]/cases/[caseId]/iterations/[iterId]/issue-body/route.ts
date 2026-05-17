import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
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
 * Access control (CR-02): the existence check below uses the
 * ZenStack-enhanced client (`getEnhancedDb(session)`) so the
 * @@allow/@@deny policies on `TestRunCaseIteration` are enforced. Any
 * authenticated caller that lacks project membership receives a 404 —
 * the upstream gate the redactor depends on.
 *
 * Sensitive parameter values are redacted per the CALLER's permission
 * (D-13) — non-sensitive values still depend on the project-membership
 * gate above. The user filing the issue sees what they're authorized to
 * see in the prefilled body. The adapter-side webhook redaction in
 * `submit-result` uses `viewerCanReadSensitive=false` independently —
 * the two paths do not share a flag.
 */

async function resolveUserContext(
  userId: string,
): Promise<{ canReadSensitive: boolean; locale: string }> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { rolePermissions: true } },
      // locale lives on UserPreferences, not User (schema.zmodel:182).
      userPreferences: { select: { locale: true } },
    },
  });
  if (!u) return { canReadSensitive: false, locale: "en_US" };
  const canReadSensitive =
    u.access === "ADMIN" ||
    (Array.isArray(u.role?.rolePermissions)
      ? u.role.rolePermissions.some(
          (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true,
        )
      : false);
  // Locale is a Prisma enum (en_US, es_ES, …). Coerce to string for the
  // server translator, which normalizes `en_US` → `en-US` internally.
  const raw = u.userPreferences?.locale;
  const locale = typeof raw === "string" && raw.length > 0 ? raw : "en_US";
  return { canReadSensitive, locale };
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

  // CR-02: enforce project membership via the ZenStack-enhanced client.
  // `getEnhancedDb` applies the @@allow/@@deny rules on
  // TestRunCaseIteration, so a caller without project access falls
  // through to "not found" — same DX, correct enforcement. This is the
  // upstream-of-redactor gate D-13 assumes.
  //
  // The `testRunCase: { testRunId }` filter is still applied so the
  // URL params are internally consistent (defense in depth against
  // IDOR via mismatched path segments).
  const db = await getEnhancedDb(session);
  const iteration = await db.testRunCaseIteration.findFirst({
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

  const { canReadSensitive: viewerCanReadSensitive, locale } =
    await resolveUserContext(session.user.id);

  try {
    const body = await buildIterationIssueBody({
      iterationId,
      viewerCanReadSensitive,
      locale,
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
