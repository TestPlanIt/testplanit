import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { integrationManager } from "~/lib/integrations/IntegrationManager";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import { milestoneSyncService } from "~/lib/integrations/services/MilestoneSyncService";
import { IMPORT_MAX_CAP } from "~/lib/integrations/services/SyncService";
import { authOptions } from "~/server/auth";

/**
 * GET /api/milestones/[milestoneId]/members/overflow
 *
 * Live tracker-member diff for a synced milestone's Issues section
 * (MLINK-02 Blocker fix). Reports the external members that are NOT yet
 * locally SYNCED-linked, wrapped in a capped-signal envelope so the client
 * can both render "in Jira but not linked" AND distinguish a real
 * IMPORT_MAX_CAP hit from ordinary membership drift.
 *
 * This route is READ-ONLY — it performs no MilestoneIssue writes. The
 * panel's "Import & link" action goes through the 18-04 reconciliation
 * path (MilestoneSyncService._reconcileMembership), which re-validates
 * membership server-side against the live adapter; this route never
 * accepts a client-supplied external-id list to import (T-18-05-02).
 *
 * projectId is re-derived server-side from the milestone row — never
 * trusted from client input (T-18-05-01/V13), same guard shape as the
 * coverage route.
 */
export type OverflowMember = {
  id: string;
  key?: string;
  title: string;
  status: string;
};

export type MemberOverflowResponse = {
  members: OverflowMember[];
  linkedCount: number;
  cap: number;
  overflowTotal: number;
};

const EMPTY_ENVELOPE: Omit<MemberOverflowResponse, "linkedCount"> = {
  members: [],
  cap: IMPORT_MAX_CAP,
  overflowTotal: 0,
};

export async function GET(
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
    // integrationId are NEVER trusted from client input.
    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        projectId: true,
        externalId: true,
        externalKind: true,
        integrationId: true,
      },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    // Local SYNCED links are ground truth for "already linked" regardless
    // of adapter support — count them even for a not-yet-synced milestone.
    const syncedLinks = await baseDb.milestoneIssue.findMany({
      where: { milestoneId, source: "SYNCED" },
      select: {
        issueId: true,
        issue: { select: { externalId: true } },
      },
    });
    const linkedCount = syncedLinks.length;
    const linkedExternalIds = new Set(
      syncedLinks
        .map((link) => link.issue.externalId)
        .filter((id): id is string => id !== null)
    );

    // Not synced (no externalId/integrationId) — nothing to diff against.
    if (!milestone.externalId || !milestone.integrationId) {
      return NextResponse.json({ ...EMPTY_ENVELOPE, linkedCount });
    }

    const adapter = await integrationManager.getAdapter(
      String(milestone.integrationId),
      baseDb
    );

    // DC/non-membership adapters: clean empty envelope, no throw.
    if (!adapter || !adapter.getMilestoneIssues) {
      return NextResponse.json({ ...EMPTY_ENVELOPE, linkedCount });
    }

    const kind = milestone.externalKind === "ITERATION" ? "ITERATION" : "RELEASE";

    // Live-fetch tracker members, paginating beyond the local cap so the
    // overflow diff can surface what the cap truncated.
    const liveMembers: OverflowMember[] = [];
    let pageToken: string | undefined;
    let liveTotal = 0;
    do {
      const page = await adapter.getMilestoneIssues(
        { id: milestone.externalId, kind },
        { pageToken, limit: 100 }
      );

      for (const issueData of page.issues) {
        liveTotal += 1;
        if (!linkedExternalIds.has(issueData.id)) {
          liveMembers.push({
            id: issueData.id,
            key: issueData.key,
            title: issueData.title,
            status: issueData.status,
          });
        }
      }

      pageToken = page.hasMore ? page.nextPageToken : undefined;
    } while (pageToken);

    const overflowTotal = Math.max(liveTotal - linkedCount, liveMembers.length);

    const response: MemberOverflowResponse = {
      members: liveMembers,
      linkedCount,
      cap: IMPORT_MAX_CAP,
      overflowTotal,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone member overflow error:", error);
    return NextResponse.json(
      { error: "Failed to fetch member overflow" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/milestones/[milestoneId]/members/overflow
 *
 * "Import & link" for the overflow panel (MLINK-02/MLINK-03, T-18-07-01).
 * Accepts NO client-supplied external-id list — it re-derives the
 * milestone's integration context server-side and re-runs the SAME
 * server-validated reconciliation path as the milestone-sync "Sync now"
 * button (`MilestoneSyncService.performMilestoneRefresh`, which internally
 * re-fetches live tracker membership via the adapter and diffs it against
 * local SYNCED links — `_reconcileMembership`). A client cannot force a
 * specific set of issues to be linked; it can only ask "sync this milestone
 * now" and the server decides what's actually a member.
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

    // Resolve the IntegrationProject mapping for this milestone's own
    // project + integration so we can reuse the same project-admin gate
    // (authorizeProjectMilestoneSyncAdmin) the milestone-sync "Sync now"
    // route uses — never trusting a client-supplied mapping id.
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

    const auth = await authorizeProjectMilestoneSyncAdmin(
      session,
      milestone.integrationId,
      mapping.id
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await milestoneSyncService.performMilestoneRefresh(
      session.user.id!,
      milestone.integrationId,
      milestone.externalId,
      { minFreshnessSeconds: 0, projectId: auth.projectId }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to import member issues" },
        { status: result.notFound ? 404 : 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Milestone member overflow import error:", error);
    return NextResponse.json(
      { error: "Failed to import member issues" },
      { status: 500 }
    );
  }
}
