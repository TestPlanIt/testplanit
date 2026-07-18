import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { baseDb } from "~/lib/db";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { ApplicationArea } from "~/zenstack/models";
import { authOptions } from "~/server/auth";

const BodySchema = z.object({ locked: z.boolean() });

/**
 * Execution-start composition lock (BOR-1). Freezes which cases are in a run
 * (add / remove / reorder) while execution and assignment continue.
 *
 * PATCH body: { locked: true } to lock, { locked: false } to unlock.
 *   - Lock: any user with TestRuns add/edit rights on the project.
 *   - Unlock: the run creator, a Project Admin, or a system ADMIN.
 *
 * The lock fields carry `@deny('update', true)`, so no enhanced/RPC client can
 * write them; this route (and the auto-lock hook) are the only writers, both via
 * the un-policed `baseDb`. The authoritative add/remove/reorder guard is the
 * `tpl_composition_lock_guard` Postgres trigger.
 */
export const PATCH = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ testRunId: string }> }
  ) => {
    const { testRunId: testRunIdParam } = await params;
    const testRunId = Number(testRunIdParam);
    if (isNaN(testRunId)) {
      return NextResponse.json(
        { error: "Invalid test run ID" },
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Stamp the actor onto the audit-context frame so the CDC trigger attributes
    // the lock/unlock write to the real user instead of __system__ (the baseDb
    // write below runs outside the enhanced client that would otherwise carry it).
    updateAuditContext({ userId });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: z.treeifyError(parsed.error) },
        { status: 400 }
      );
    }
    const { locked } = parsed.data;

    const run = await baseDb.testRuns.findFirst({
      where: { id: testRunId, isDeleted: false },
      select: {
        id: true,
        projectId: true,
        createdById: true,
        isCompleted: true,
        compositionLockedAt: true,
      },
    });
    if (!run) {
      return NextResponse.json(
        { error: "Test run not found" },
        { status: 404 }
      );
    }
    // A completed run's composition is already permanently frozen by the
    // completion lock — the composition lock is a no-op there.
    if (run.isCompleted) {
      return NextResponse.json(
        { error: "Test run is completed and already frozen" },
        { status: 409 }
      );
    }

    if (locked) {
      // Lock: anyone who can add/edit runs in this project.
      const canEdit = await userCanAddEditArea(
        userId,
        run.projectId,
        ApplicationArea.TestRuns,
        session.user.access
      );
      if (!canEdit) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (run.compositionLockedAt) {
        // Idempotent: already locked.
        return NextResponse.json({
          locked: true,
          compositionLockedAt: run.compositionLockedAt,
        });
      }
      // Write inside an auditedTransaction so the CDC trigger attributes the
      // lock to the acting user (a bare baseDb write's implicit-transaction GUC
      // injection is unreliable for single autocommit statements → __system__).
      const updated = await auditedTransaction((tx) =>
        tx.testRuns.update({
          where: { id: testRunId },
          data: {
            compositionLockedAt: new Date(),
            compositionLockedById: userId,
          },
          select: { compositionLockedAt: true, compositionLockedById: true },
        })
      );
      return NextResponse.json({
        locked: true,
        compositionLockedAt: updated.compositionLockedAt,
        compositionLockedById: updated.compositionLockedById,
      });
    }

    // Unlock: run creator, system ADMIN, or Project Admin. Short-circuits so the
    // creator / system ADMIN paths skip the project-admin lookup.
    const canUnlock =
      run.createdById === userId ||
      session.user.access === "ADMIN" ||
      (await authorizeProjectAdminForProject(session, run.projectId)).ok;
    if (!canUnlock) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!run.compositionLockedAt) {
      // Idempotent: already unlocked.
      return NextResponse.json({ locked: false });
    }
    await auditedTransaction((tx) =>
      tx.testRuns.update({
        where: { id: testRunId },
        data: { compositionLockedAt: null, compositionLockedById: null },
      })
    );
    return NextResponse.json({ locked: false });
  }
);
