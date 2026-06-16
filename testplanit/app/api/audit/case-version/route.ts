import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getEnhancedDb } from "~/lib/auth/utils";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { diffCaseVersionContent } from "~/lib/services/caseVersionDiff";
import { getServerAuthSession } from "~/server/auth";

/**
 * POST /api/audit/case-version
 *
 * Records a consolidated audit entry for a test-case edit: the content changes
 * (custom field values, steps, tags, issues, parameters) that the scalar
 * RepositoryCases update does not capture. Called by the case editor after a
 * successful save. The diff compares the two most recent version snapshots, so
 * it reflects exactly what this edit changed; the entry shares the case's
 * entityType/entityId so it appears in the per-case activity view alongside the
 * scalar update.
 *
 * Best-effort and complementary, not authoritative: the per-row CaseFieldValues
 * audit hooks remain the completeness backstop. Reads go through the
 * access-enhanced client, so a caller can only trigger an entry for a case they
 * are allowed to read.
 */
export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const caseId = Number(body?.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return NextResponse.json({ error: "Invalid caseId" }, { status: 400 });
    }

    const db = await getEnhancedDb(session);
    const versions = await db.repositoryCaseVersions.findMany({
      where: { repositoryCaseId: caseId },
      orderBy: { version: "desc" },
      take: 2,
      select: {
        version: true,
        name: true,
        projectId: true,
        steps: true,
        tags: true,
        issues: true,
        parameters: true,
        caseFieldVersionValues: { select: { field: true, value: true } },
      },
    });

    // Nothing to diff against on the first version (case creation).
    if (versions.length < 2) {
      return NextResponse.json({ success: true });
    }

    const [current, previous] = versions;
    const changes = diffCaseVersionContent(previous, current);

    if (changes && Object.keys(changes).length > 0) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "RepositoryCases",
        entityId: String(caseId),
        entityName: current.name,
        changes,
        projectId: current.projectId,
        metadata: {
          scope: "content",
          fromVersion: previous.version,
          toVersion: current.version,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[AuditCaseVersion] Error recording case content audit:",
      error
    );
    return NextResponse.json(
      { error: "Failed to record case content audit" },
      { status: 500 }
    );
  }
});
