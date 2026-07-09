import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import { milestoneSyncService } from "~/lib/integrations/services/MilestoneSyncService";
import { authOptions } from "~/server/auth";

/**
 * POST /api/milestones/[milestoneId]/unlink
 *
 * D-09/D-11 manual unlink escape hatch (HOOK-03): a project admin detaches a
 * synced milestone from its tracker source, converting it to a plain local
 * milestone with NO badge (distinct from an upstream deleted/merged
 * conversion, which keeps a permanent badge — see MilestoneSourceBadge).
 *
 * Thin wrapper over MilestoneSyncService.convertMilestoneToLocal (Plan 03),
 * which owns the single-transaction detach + three-way externalState +
 * bulk SYNCED->MANUAL MilestoneIssue flip + reason-tagged audit + wake-up
 * publishes. This route's only job is: resolve project/integration/mapping
 * server-side from the milestone row (never client input, T-19-05-02),
 * gate via authorizeProjectMilestoneSyncAdmin (T-19-05-01, the Phase 18
 * lesson that sibling milestone routes shipped ungated), then call
 * convertMilestoneToLocal with reason "manual_unlink".
 *
 * Path uses [milestoneId] (not the plan's literal [id]) — Next.js's App
 * Router rejects sibling dynamic segments with different slug names, and
 * six existing sibling routes under app/api/milestones/ already use
 * [milestoneId] (see 19-02-SUMMARY.md's identical precedent for the SSE
 * stream route).
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await context.params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Resolve the milestone row server-side — projectId/externalId/
    // integrationId are NEVER trusted from client input (T-19-05-02).
    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        projectId: true,
        externalId: true,
        integrationId: true,
      },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    if (!milestone.externalId || !milestone.integrationId) {
      return NextResponse.json(
        { error: "Milestone is not synced with an issue tracker" },
        { status: 400 }
      );
    }

    // Resolve the IntegrationProject mapping server-side so we can reuse
    // the same project-admin gate the milestone-sync routes use — never
    // trusting a client-supplied mapping id (T-19-05-02).
    const mapping = await baseDb.integrationProject.findFirst({
      where: {
        isActive: true,
        projectIntegration: {
          projectId: milestone.projectId,
          integrationId: milestone.integrationId,
        },
      },
      select: { id: true },
    });

    if (!mapping) {
      return NextResponse.json(
        { error: "Integration mapping not found" },
        { status: 404 }
      );
    }

    // T-19-05-01: reuse authorizeProjectMilestoneSyncAdmin UNMODIFIED — it
    // already encodes the Milestones @@allow ACL (creator / Project Admin
    // role / PROJECTADMIN / ADMIN) that the raw-db conversion below must
    // replicate in application code, since baseDb bypasses policy.
    const auth = await authorizeProjectMilestoneSyncAdmin(
      session,
      milestone.integrationId,
      mapping.id
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // D-11/D-12: same detached mechanics as an upstream deleted/merged
    // conversion; only the reason (and therefore the badge) differs.
    // convertMilestoneToLocal is idempotent — calling unlink twice on an
    // already-detached milestone succeeds as a no-op. The acting admin's
    // user id is passed as the audit actor (T-19-05-04): a manual unlink is
    // an admin-initiated action and must never be attributed to
    // SYSTEM_ACTOR_ID the way webhook-driven conversions are.
    const result = await milestoneSyncService.convertMilestoneToLocal(
      baseDb,
      milestoneId,
      "manual_unlink",
      undefined,
      session.user.id
    );

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to unlink milestone" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Milestone unlink error:", error);
    return NextResponse.json(
      { error: "Failed to unlink milestone" },
      { status: 500 }
    );
  }
}
