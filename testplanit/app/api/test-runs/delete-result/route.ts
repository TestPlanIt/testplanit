import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { authenticateRequest } from "~/lib/api-token-auth";
import { updateAuditContext } from "~/lib/auditContext";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { hasResultMutationPermission } from "~/lib/services/resultGuards";
import { syncRunCaseStatusAfterResultRemoval } from "~/lib/services/runCaseStatusSync";
import { isNotFoundError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

/**
 * Soft-deletes a manual test-run result and re-derives the owning run-case's
 * status in the same transaction.
 *
 * Deleting used to go straight through the ZenStack model API
 * (`testRunResults.update({ isDeleted: true })`), which flipped the flag and
 * nothing else. `TestRunCases.statusId` is denormalized (see
 * `lib/services/runCaseStatusSync.ts`) and every run-level view reads it, so
 * removing the newest result left the run reporting an outcome whose result
 * row was gone from the history — the same divergence the edit path had.
 *
 * Routing it through here also gives deletes the permission check and
 * completed-run lock the other result mutations enforce, instead of relying on
 * the schema policy alone.
 */
const deleteResultSchema = z.object({
  resultId: z.number().int().positive(),
});

export const POST = withAuditContext(async (req: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);
    const auth = await authenticateRequest(req, session);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error, code: auth.errorCode },
        { status: auth.status }
      );
    }
    const authenticatedUserId = auth.user.userId;
    updateAuditContext({ userId: authenticatedUserId });

    const body = await req.json();
    const parsed = deleteResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: z.treeifyError(parsed.error) },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const user = await baseDb.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        id: true,
        access: true,
        role: {
          select: {
            rolePermissions: {
              where: { area: "TestRunResults", canAddEdit: true },
              select: { canAddEdit: true },
            },
          },
        },
      },
    });
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await baseDb.testRunResults.findFirst({
      where: { id: input.resultId, isDeleted: false },
      select: {
        id: true,
        testRunCaseId: true,
        iterationId: true,
        testRunCase: {
          select: {
            assignedToId: true,
            testRun: {
              select: {
                name: true,
                createdById: true,
                projectId: true,
                isCompleted: true,
                project: {
                  select: {
                    createdBy: true,
                    defaultAccessType: true,
                    assignedUsers: {
                      where: { userId: user.id },
                      select: { userId: true },
                    },
                    userPermissions: {
                      where: { userId: user.id },
                      select: {
                        accessType: true,
                        role: {
                          select: {
                            name: true,
                            rolePermissions: {
                              where: {
                                area: "TestRunResults",
                                canAddEdit: true,
                              },
                              select: { canAddEdit: true },
                            },
                          },
                        },
                      },
                    },
                    groupPermissions: {
                      where: {
                        group: {
                          assignedUsers: { some: { userId: user.id } },
                        },
                      },
                      select: {
                        accessType: true,
                        role: {
                          select: {
                            name: true,
                            rolePermissions: {
                              where: {
                                area: "TestRunResults",
                                canAddEdit: true,
                              },
                              select: { canAddEdit: true },
                            },
                          },
                        },
                      },
                    },
                    defaultRole: {
                      select: {
                        name: true,
                        rolePermissions: {
                          where: { area: "TestRunResults", canAddEdit: true },
                          select: { canAddEdit: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Test run result not found", code: "RESULT_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (
      !hasResultMutationPermission({
        user,
        testRunCreatedById: existing.testRunCase.testRun.createdById,
        assignedToId: existing.testRunCase.assignedToId,
        project: existing.testRunCase.testRun.project,
      })
    ) {
      return NextResponse.json(
        { error: "Permission denied", code: "PERMISSION_DENIED" },
        { status: 403 }
      );
    }

    // A completed run is frozen: results can no longer be removed.
    if (existing.testRunCase.testRun.isCompleted) {
      return NextResponse.json(
        {
          error: "This test run is completed and can no longer be modified",
          code: "RUN_COMPLETED",
        },
        { status: 409 }
      );
    }

    // The delete writes the result + run-case rows but not the owning TestRuns
    // row, so stamp the run's name + project onto the audit frame for
    // lookup-free attribution (same as submit-result / edit-result).
    updateAuditContext({
      subjectEntityName: existing.testRunCase.testRun.name ?? undefined,
      subjectProjectId: existing.testRunCase.testRun.projectId,
    });

    await auditedTransaction(async (tx) => {
      // `deletedAt` is stamped by the tpl_stamp_deleted_at_testrunresults
      // BEFORE trigger, so the flag is all this needs to set.
      await tx.testRunResults.update({
        where: { id: input.resultId },
        data: { isDeleted: true },
      });

      await syncRunCaseStatusAfterResultRemoval(tx, {
        testRunCaseId: existing.testRunCaseId,
        iterationId: existing.iterationId,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json(
        { error: "Test run result not found", code: "RESULT_NOT_FOUND" },
        { status: 404 }
      );
    }
    console.error("Error deleting test run result:", error);
    return NextResponse.json(
      { error: "Failed to delete result", code: "DELETE_RESULT_FAILED" },
      { status: 500 }
    );
  }
});
