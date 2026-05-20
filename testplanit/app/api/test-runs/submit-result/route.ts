import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authenticateRequest } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";
import { emitIterationResultRecorded } from "~/lib/webhooks/event-emitters/iterationEvents";
import { authOptions } from "~/server/auth";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";

const submitResultSchema = z.object({
  testRunId: z.number().int().positive(),
  testRunCaseId: z.number().int().positive(),
  statusId: z.number().int().positive(),
  notes: z.unknown().optional(),
  evidence: z.unknown().optional(),
  elapsed: z.number().int().nonnegative().nullable().optional(),
  attempt: z.number().int().positive(),
  testRunCaseVersion: z.number().int().positive(),
  issueIds: z.array(z.number().int().positive()).optional(),
  inProgressStateId: z.number().int().positive().nullable().optional(),
  // Phase 3 Wave 2 (Task 6): when set, the result is attributed to a specific
  // iteration of a parameterized run-case. Activates the worst-of rollup
  // path; absence preserves the byte-identical legacy behavior (PARAM-07).
  iterationId: z.number().int().positive().optional(),
});

/**
 * Sentinel thrown inside the transaction when the supplied iterationId does
 * not belong to the run-case. Caught at the top-level handler and surfaced
 * as a 404 without leaking the schema-level error message.
 */
class IterationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IterationNotFoundError";
  }
}

/**
 * Resolves whether the authenticated user holds the `canReadSensitive`
 * permission on ANY of their role rows. Mirrors `resolveCanReadSensitive`
 * in `app/api/repository/cases/[caseId]/dataset/route.ts` — same broad
 * check (sensitive parameter values are sensitive across all surfaces, not
 * scoped per ApplicationArea).
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
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true
      )
    : false;
}

/**
 * Coerces the snapshot's `parametersJson` into the narrow
 * ParameterSchemaEntry[] shape consumed by `redactValues`. The snapshot
 * column is `Json` so we accept a few defensive shapes:
 *   - array of `{ name, sensitive }` (the materializer's normal output)
 *   - any non-array / null → empty schema (redactor passes values through
 *     unchanged when no entries are sensitive)
 */
function parseParameterSchema(
  value: Prisma.JsonValue | null | undefined
): ParameterSchemaEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ParameterSchemaEntry[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      const e = entry as Record<string, unknown>;
      out.push({
        name: String(e.name),
        sensitive: e.sensitive === true,
      });
    }
  }
  return out;
}

type RolePermissionSnapshot =
  | {
      name?: string | null;
      rolePermissions?: Array<{ canAddEdit: boolean }> | null;
    }
  | null
  | undefined;

type ProjectAccessTypeValue =
  | "DEFAULT"
  | "NO_ACCESS"
  | "GLOBAL_ROLE"
  | "SPECIFIC_ROLE";

function roleCanAddEditTestRunResults(role: RolePermissionSnapshot): boolean {
  return Boolean(
    role?.rolePermissions?.some((permission) => permission.canAddEdit)
  );
}

function hasSubmitResultPermission({
  user,
  testRunCreatedById,
  assignedToId,
  project,
}: {
  user: {
    id: string;
    access: string;
    role: {
      rolePermissions: Array<{ canAddEdit: boolean }>;
    } | null;
  };
  testRunCreatedById: string;
  assignedToId: string | null;
  project: {
    createdBy: string;
    defaultAccessType: ProjectAccessTypeValue;
    defaultRole: RolePermissionSnapshot;
    assignedUsers: Array<{ userId: string }>;
    userPermissions: Array<{
      accessType: ProjectAccessTypeValue;
      role: RolePermissionSnapshot;
    }>;
    groupPermissions: Array<{
      accessType: ProjectAccessTypeValue;
      role: RolePermissionSnapshot;
    }>;
  };
}): boolean {
  if (user.access === "ADMIN") {
    return true;
  }

  if (project.createdBy === user.id) {
    return true;
  }

  if (testRunCreatedById === user.id) {
    return true;
  }

  if (assignedToId === user.id) {
    return true;
  }

  if (
    user.access === "PROJECTADMIN" &&
    project.assignedUsers.some((assignment) => assignment.userId === user.id)
  ) {
    return true;
  }

  const hasGlobalRoleResultPermission = roleCanAddEditTestRunResults(user.role);

  const explicitUserPermission = project.userPermissions[0];
  if (explicitUserPermission) {
    if (explicitUserPermission.accessType === "NO_ACCESS") {
      return false;
    }

    if (explicitUserPermission.accessType === "SPECIFIC_ROLE") {
      return (
        explicitUserPermission.role?.name === "Project Admin" ||
        roleCanAddEditTestRunResults(explicitUserPermission.role)
      );
    }

    if (explicitUserPermission.accessType === "GLOBAL_ROLE") {
      return user.access !== "NONE" && hasGlobalRoleResultPermission;
    }
  }

  const groupPermissionAllows = project.groupPermissions.some(
    (groupPermission) => {
      if (groupPermission.accessType === "SPECIFIC_ROLE") {
        return (
          groupPermission.role?.name === "Project Admin" ||
          roleCanAddEditTestRunResults(groupPermission.role)
        );
      }

      if (groupPermission.accessType === "GLOBAL_ROLE") {
        return user.access !== "NONE" && hasGlobalRoleResultPermission;
      }

      return false;
    }
  );
  if (groupPermissionAllows) {
    return true;
  }

  if (project.defaultAccessType === "GLOBAL_ROLE") {
    return user.access !== "NONE" && hasGlobalRoleResultPermission;
  }

  if (project.defaultAccessType === "SPECIFIC_ROLE") {
    return (
      project.assignedUsers.some(
        (assignment) => assignment.userId === user.id
      ) && roleCanAddEditTestRunResults(project.defaultRole)
    );
  }

  return false;
}

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const parsed = submitResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: z.treeifyError(parsed.error),
        },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const user = await prisma.user.findUnique({
      where: {
        id: authenticatedUserId,
      },
      select: {
        id: true,
        access: true,
        role: {
          select: {
            rolePermissions: {
              where: {
                area: "TestRunResults",
                canAddEdit: true,
              },
              select: {
                canAddEdit: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const runCase = await prisma.testRunCases.findFirst({
      where: {
        id: input.testRunCaseId,
        testRunId: input.testRunId,
        testRun: {
          isDeleted: false,
          project: {
            isDeleted: false,
          },
        },
      },
      select: {
        id: true,
        assignedToId: true,
        repositoryCaseId: true,
        repositoryCase: {
          select: { automated: true },
        },
        testRun: {
          select: {
            id: true,
            projectId: true,
            createdById: true,
            testRunType: true,
            project: {
              select: {
                createdBy: true,
                defaultAccessType: true,
                assignedUsers: {
                  where: {
                    userId: user.id,
                  },
                  select: {
                    userId: true,
                  },
                },
                userPermissions: {
                  where: {
                    userId: user.id,
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
                          select: {
                            canAddEdit: true,
                          },
                        },
                      },
                    },
                  },
                },
                groupPermissions: {
                  where: {
                    group: {
                      assignedUsers: {
                        some: {
                          userId: user.id,
                        },
                      },
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
                          select: {
                            canAddEdit: true,
                          },
                        },
                      },
                    },
                  },
                },
                defaultRole: {
                  select: {
                    name: true,
                    rolePermissions: {
                      where: {
                        area: "TestRunResults",
                        canAddEdit: true,
                      },
                      select: {
                        canAddEdit: true,
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

    if (!runCase) {
      return NextResponse.json(
        { error: "Test run case not found", code: "TEST_RUN_CASE_NOT_FOUND" },
        { status: 404 }
      );
    }

    const canSubmit = hasSubmitResultPermission({
      user,
      testRunCreatedById: runCase.testRun.createdById,
      assignedToId: runCase.assignedToId,
      project: runCase.testRun.project,
    });
    if (!canSubmit) {
      return NextResponse.json(
        { error: "Permission denied", code: "PERMISSION_DENIED" },
        { status: 403 }
      );
    }

    const notesInput:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput
      | undefined =
      input.notes === undefined
        ? undefined
        : input.notes === null
          ? Prisma.JsonNull
          : (input.notes as Prisma.InputJsonValue);

    const evidenceInput: Prisma.InputJsonValue =
      input.evidence === undefined || input.evidence === null
        ? {}
        : (input.evidence as Prisma.InputJsonValue);

    // Resolve `canReadSensitive` once per request — used at the audit
    // boundary to redact iteration parameter values for viewers who lack the
    // permission. Mirrors the `resolveCanReadSensitive` helper in
    // `app/api/repository/cases/[caseId]/dataset/route.ts`: a single boolean
    // covering the user across all RolePermission rows. Skipped entirely on
    // the legacy (non-iteration) path to avoid an unnecessary DB hit.
    const viewerCanReadSensitive: boolean = input.iterationId
      ? await resolveCanReadSensitive(authenticatedUserId)
      : false;

    const isAutomatedRun = runCase.testRun.testRunType !== "REGULAR";
    const needsAutomatedFlip =
      isAutomatedRun && !runCase.repositoryCase.automated;

    // Audit-event payload assembled inside the transaction (so it has the
    // iteration row + snapshot params), enqueued AFTER commit. Audit
    // emission is best-effort and must never roll back the result write.
    type AuditPayload = {
      iterationId: number;
      rowIndex: number;
      redactedValues: Record<string, unknown>;
      statusId: number;
      projectId: number;
    };

    const txOutcome = await prisma.$transaction(async (tx) => {
      let auditPayload: AuditPayload | null = null;
      const createdResult = await tx.testRunResults.create({
        data: {
          testRunId: input.testRunId,
          testRunCaseId: input.testRunCaseId,
          // The iteration FK is set ONLY on the parameterized path. Non-
          // parameterized cases continue to write `iterationId = null`
          // exactly as before (PARAM-07: byte-identical legacy behavior).
          iterationId: input.iterationId ?? null,
          statusId: input.statusId,
          notes: notesInput,
          evidence: evidenceInput,
          elapsed: input.elapsed ?? null,
          executedById: user.id,
          attempt: input.attempt,
          testRunCaseVersion: input.testRunCaseVersion,
          issues:
            input.issueIds && input.issueIds.length > 0
              ? { connect: input.issueIds.map((id) => ({ id })) }
              : undefined,
        },
      });

      if (input.iterationId) {
        // ─── Iteration branch (Phase 3 Wave 2 Task 6) ─────────────────
        // 1. Verify the iteration belongs to this run-case. Throwing here
        //    rolls back the TestRunResults insert above — atomicity intact.
        const iter = await tx.testRunCaseIteration.findFirst({
          where: {
            id: input.iterationId,
            testRunCaseId: input.testRunCaseId,
            isDeleted: false,
          },
          select: { id: true, rowIndex: true, valuesJson: true },
        });
        if (!iter) {
          throw new IterationNotFoundError(
            `Iteration ${input.iterationId} not found or not owned by run-case ${input.testRunCaseId}`
          );
        }

        // 2. Mark the iteration as completed. The submitted status is the
        //    iteration's new statusId; isCompleted is forced true regardless
        //    of the Status row's own `isCompleted` flag — submission is the
        //    completion signal at the iteration level (per PLAN.md Task 6
        //    step 3, completedAt = now()).
        await tx.testRunCaseIteration.update({
          where: { id: input.iterationId },
          data: {
            statusId: input.statusId,
            isCompleted: true,
            completedAt: new Date(),
          },
        });

        // 3. Reload all live iterations (post-update) plus their statuses
        //    so we can compute the rollup against the freshest data.
        const iterations = await tx.testRunCaseIteration.findMany({
          where: {
            testRunCaseId: input.testRunCaseId,
            isDeleted: false,
          },
          select: {
            statusId: true,
            status: {
              select: {
                id: true,
                systemName: true,
                isSuccess: true,
                isFailure: true,
                isCompleted: true,
              },
            },
          },
        });

        // Build the lookup map for the rollup helper. Add the seeded
        // `untested` row up-front so iterations with statusId=null still
        // resolve cleanly. Using findMany on Status with a small set is
        // cheap (Status table has < 10 rows).
        const allStatuses = await tx.status.findMany({
          where: { isDeleted: false },
          select: {
            id: true,
            systemName: true,
            isSuccess: true,
            isFailure: true,
            isCompleted: true,
            order: true,
          },
        });
        const statusMap = new Map<number, RollupStatus>(
          allStatuses.map((s) => [
            s.id,
            {
              id: s.id,
              systemName: s.systemName,
              isSuccess: s.isSuccess,
              isFailure: s.isFailure,
              isCompleted: s.isCompleted,
              order: s.order,
            },
          ])
        );

        const rollupStatusId = computeWorstOfStatus(
          iterations.map((it) => ({ statusId: it.statusId })),
          statusMap
        );

        // 4. Counter recompute. `totalIterations` is set at fan-out time
        //    and never recomputed here per PLAN.md Task 6 step 4 invariant.
        const passedCount = iterations.filter(
          (it) => it.status?.isSuccess === true
        ).length;
        const failedCount = iterations.filter(
          (it) => it.status?.isFailure === true
        ).length;
        const skippedCount = iterations.filter(
          (it) =>
            it.status != null &&
            it.status.isSuccess === false &&
            it.status.isFailure === false &&
            it.status.isCompleted === true
        ).length;

        await tx.testRunCases.update({
          where: { id: input.testRunCaseId },
          data: {
            // Fall back to the submitted status if the rollup returns null
            // (defensive — empty iteration list is impossible under
            // PARAM-07 but the helper handles it).
            statusId: rollupStatusId ?? input.statusId,
            passedIterations: passedCount,
            failedIterations: failedCount,
            skippedIterations: skippedCount,
          },
        });

        // 5. Stash the audit payload for post-commit emission. Pull the
        //    parameter schema from the snapshot — that's the canonical
        //    in-flight schema (snapshot-at-creation rule). Live
        //    TestCaseParameter rows could have changed since run create.
        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: input.testRunCaseId },
          select: { parametersJson: true },
        });
        const paramSchema = parseParameterSchema(snapshot?.parametersJson);
        const iterValues = (iter.valuesJson ?? {}) as Record<string, unknown>;
        auditPayload = {
          iterationId: input.iterationId,
          rowIndex: iter.rowIndex,
          redactedValues: redactValues(
            iterValues,
            paramSchema,
            viewerCanReadSensitive
          ),
          statusId: input.statusId,
          projectId: runCase.testRun.projectId,
        };

        // INT-04 / D-13 — separately compute the webhook redaction with
        // `viewerCanReadSensitive=false`. NEVER reuse `auditPayload.redactedValues`:
        // the audit uses the SUBMITTING user's permission (potentially `true`)
        // and reusing it would leak sensitive cleartext to webhook
        // subscribers. The two redactions are computed independently from
        // the same `iterValues + paramSchema` inputs.
        const webhookRedactedValues = redactValues(
          iterValues,
          paramSchema,
          false
        );
        await emitIterationResultRecorded(
          {
            iterationId: input.iterationId,
            testRunCaseId: input.testRunCaseId,
            testRunId: input.testRunId,
            statusId: input.statusId,
            projectId: runCase.testRun.projectId,
            rowIndex: iter.rowIndex,
            redactedValues: webhookRedactedValues,
          },
          tx,
          { actorUserId: user.id }
        );
      } else {
        // ─── Legacy branch (no iterationId) — unchanged behavior ──────
        // Preserves PARAM-07: non-parameterized cases see byte-identical
        // semantics. Direct status write, no rollup, no iteration counters.
        await tx.testRunCases.update({
          where: {
            id: input.testRunCaseId,
          },
          data: {
            statusId: input.statusId,
          },
        });
      }

      if (needsAutomatedFlip) {
        await tx.repositoryCases.update({
          where: { id: runCase.repositoryCaseId },
          data: { automated: true },
        });
      }

      if (input.inProgressStateId) {
        const previousResult = await tx.testRunResults.findFirst({
          where: {
            testRunId: input.testRunId,
            isDeleted: false,
            id: {
              not: createdResult.id,
            },
          },
          select: {
            id: true,
          },
        });

        if (!previousResult) {
          await tx.testRuns.update({
            where: {
              id: input.testRunId,
            },
            data: {
              stateId: input.inProgressStateId,
            },
          });

          // Stamp consumedAt on every approval the gate consumed. Strict
          // transitive gates can return multiple ids when one transition
          // crosses several gated states; a short stamp count means another
          // caller raced us — surface as REVIEW_REQUIRED so the whole
          // transaction rolls back.
          if (gateApprovals && gateApprovals.approvedRequestIds.length > 0) {
            const stamp = await tx.reviewRequest.updateMany({
              where: {
                id: { in: gateApprovals.approvedRequestIds },
                consumedAt: null,
              },
              data: { consumedAt: new Date() },
            });
            if (stamp.count !== gateApprovals.approvedRequestIds.length) {
              throw new ReviewGateError(
                "REVIEW_REQUIRED",
                "RUN",
                input.testRunId,
                input.inProgressStateId
              );
            }
          }
        }
      }

      return { createdResult, auditPayload };
    });

    const { createdResult: result, auditPayload } = txOutcome;

    // Post-commit audit emission. Best-effort — never block the response
    // on the audit pipeline (matches the captureAuditEvent contract; the
    // helper itself swallows enqueue failures). We emit OUTSIDE the
    // transaction because the audit queue is BullMQ; a Valkey hiccup must
    // not roll back a successful result write.
    if (auditPayload) {
      captureAuditEvent({
        action: "ITERATION_RESULT_RECORDED",
        entityType: "TestRunCaseIteration",
        entityId: String(auditPayload.iterationId),
        projectId: auditPayload.projectId,
        userId: user.id,
        metadata: {
          iterationRowIndex: auditPayload.rowIndex,
          valuesJson: auditPayload.redactedValues,
          statusId: auditPayload.statusId,
          testRunCaseId: input.testRunCaseId,
          testRunId: input.testRunId,
        },
      }).catch(() => {
        // Audit is best-effort — never block the API response on it.
      });
    }

    if (needsAutomatedFlip) {
      void syncRepositoryCaseToElasticsearch(runCase.repositoryCaseId).catch(
        (err) =>
          console.error(
            `ES sync failed after automated flag update for case ${runCase.repositoryCaseId}:`,
            err
          )
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof IterationNotFoundError) {
      return NextResponse.json(
        { error: "Iteration not found", code: "ITERATION_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (
      typeof Prisma?.PrismaClientKnownRequestError === "function" &&
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2025") {
        return NextResponse.json(
          { error: "Test run case not found", code: "TEST_RUN_CASE_NOT_FOUND" },
          { status: 404 }
        );
      }
    }

    console.error("Error submitting test run result:", error);
    return NextResponse.json(
      { error: "Failed to submit result", code: "SUBMIT_RESULT_FAILED" },
      { status: 500 }
    );
  }
}
