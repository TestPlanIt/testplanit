import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import {
  isProjectAdminFor,
  userHasAreaPermission,
} from "~/lib/services/areaPermission";
import { decideSuggestion } from "~/lib/services/caseUpkeep/decide";
import { regenerateSuggestion } from "~/lib/services/caseUpkeep/regenerate";
import { authOptions } from "~/server/auth";

const bodySchema = z.object({
  action: z.enum(["apply", "dismiss", "regenerate"]),
});

/** The HTTP status each refusal answers with; the body carries the code. */
const STATUS_BY_CODE = {
  not_found: 404,
  gone: 404,
  not_pending: 409,
  stale: 409,
  no_llm: 409,
  failed: 502,
} as const;

/**
 * Decide a suggested change to a test case: apply it, dismiss it, or work it
 * out again against the case as it reads now. Open to whoever may edit test
 * cases in the project, the same people who could make the change by hand.
 */
const handlePOST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ caseId: string; suggestionId: string }> }
  ) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const raw = await params;
    const caseId = Number(raw.caseId);
    const suggestionId = Number(raw.suggestionId);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (
      !Number.isInteger(caseId) ||
      !Number.isInteger(suggestionId) ||
      !body.success
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const testCase = await baseDb.repositoryCases.findUnique({
      where: { id: caseId },
      select: { projectId: true },
    });
    if (!testCase) {
      return NextResponse.json({ code: "not_found" }, { status: 404 });
    }
    const mayEdit =
      (await isProjectAdminFor(userId, testCase.projectId)) ||
      (await userHasAreaPermission(
        userId,
        testCase.projectId,
        "TestCaseRepository",
        "canAddEdit"
      ));
    if (!mayEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const result =
        body.data.action === "regenerate"
          ? await regenerateSuggestion(baseDb, {
              suggestionId,
              caseId,
              userId,
              tenantId: getCurrentTenantId(),
            })
          : await auditedTransaction((tx) =>
              decideSuggestion(tx, {
                suggestionId,
                caseId,
                action: body.data.action as "apply" | "dismiss",
                userId,
              })
            );
      if (!result.ok) {
        return NextResponse.json(
          { code: result.code },
          { status: STATUS_BY_CODE[result.code] }
        );
      }
      return NextResponse.json(result);
    } catch (error) {
      console.error("Error deciding a case change suggestion:", error);
      return NextResponse.json({ code: "failed" }, { status: 500 });
    }
  }
);

export const POST = withRequestRouting(handlePOST);
