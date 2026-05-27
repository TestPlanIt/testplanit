import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { authenticateRequest } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { calculateDiff, captureAuditEvent } from "~/lib/services/auditLog";
import {
  assertResultEditWindowOpen,
  isEditWindowExpiredError,
} from "~/lib/services/editWindow";
import {
  failsIssueOnFailureGate,
  hasMissingRequiredResultField,
  hasResultMutationPermission,
  isOutcomeFlip,
} from "~/lib/services/resultGuards";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { authOptions } from "~/server/auth";

/**
 * Edits an existing manual test-run result under the same governance as
 * recording one (`submit-result`): the edit window, required result fields,
 * and flip justification are all enforced server-side, atomically with the
 * result + field-value writes, and a before/after audit event is emitted.
 *
 * The flip comparison uses the result's *current* status as the prior — an
 * edit that changes one completed outcome to a different completed outcome is
 * the flip. Step results and attachments are handled by the caller via their
 * own writes; this endpoint owns the result row, its field values, and the
 * gates so API/MCP/UI edits can't bypass them.
 */
const editResultSchema = z.object({
  resultId: z.number().int().positive(),
  statusId: z.number().int().positive(),
  notes: z.unknown().optional(),
  evidence: z.unknown().optional(),
  elapsed: z.number().int().nonnegative().nullable().optional(),
  testRunCaseVersion: z.number().int().positive().optional(),
  issueIds: z.array(z.number().int().positive()).optional(),
  // Count of step / shared-step issues linked for this result after the edit.
  // Counted alongside result-level issues by the require-issue-on-failure gate.
  // Omitted (raw API edits not touching step issues) falls back to the result's
  // current step-issue count.
  stepIssueCount: z.number().int().nonnegative().optional(),
  fieldValues: z
    .array(
      z.object({
        fieldId: z.number().int().positive(),
        value: z.unknown(),
      })
    )
    .optional(),
});

// Scalar fields captured before and after the update so the audit event
// records an accurate field-level diff (calculateDiff skips timestamps/ids it
// doesn't care about and masks sensitive values).
const auditableSelect = {
  statusId: true,
  notes: true,
  evidence: true,
  elapsed: true,
  editedById: true,
  editedAt: true,
  testRunCaseVersion: true,
} as const;

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
    const parsed = editResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: z.treeifyError(parsed.error) },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const user = await prisma.user.findUnique({
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

    // Load the result with its run-case + project (permission fields filtered
    // to this user, mirroring submit-result), plus the prior status, template,
    // and existing field-value rows for the upsert.
    const existing = await prisma.testRunResults.findFirst({
      where: { id: input.resultId, isDeleted: false },
      select: {
        id: true,
        statusId: true,
        testRunCaseId: true,
        resultFieldValues: { select: { id: true, fieldId: true } },
        issues: { select: { id: true } },
        stepResults: { select: { _count: { select: { issues: true } } } },
        testRunCase: {
          select: {
            assignedToId: true,
            repositoryCase: { select: { templateId: true } },
            testRun: {
              select: {
                createdById: true,
                projectId: true,
                project: {
                  select: {
                    createdBy: true,
                    defaultAccessType: true,
                    requireResultFlipJustification: true,
                    requireIssueOnFailure: true,
                    projectIntegrations: {
                      where: {
                        isActive: true,
                        integration: { status: "ACTIVE" },
                      },
                      select: { id: true },
                      take: 1,
                    },
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

    const project = existing.testRunCase.testRun.project;

    if (
      !hasResultMutationPermission({
        user,
        testRunCreatedById: existing.testRunCase.testRun.createdById,
        assignedToId: existing.testRunCase.assignedToId,
        project,
      })
    ) {
      return NextResponse.json(
        { error: "Permission denied", code: "PERMISSION_DENIED" },
        { status: 403 }
      );
    }

    // Edit window — same guard as the model route, system admins bypass.
    try {
      await assertResultEditWindowOpen(prisma, input.resultId, user.access);
    } catch (error) {
      if (isEditWindowExpiredError(error)) {
        return NextResponse.json(
          { error: error.message, code: "EDIT_WINDOW_EXPIRED" },
          { status: 403 }
        );
      }
      throw error;
    }

    // Required result fields.
    const missingRequiredField = await hasMissingRequiredResultField(
      prisma,
      existing.testRunCase.repositoryCase.templateId,
      input.fieldValues
    );
    if (missingRequiredField) {
      return NextResponse.json(
        {
          error: "A required result field is missing a value",
          code: "REQUIRED_FIELDS_MISSING",
        },
        { status: 400 }
      );
    }

    // Mandatory defect link on failure (opt-in per project), mirroring
    // submit-result. Counts result-level and step/shared issues. When a count
    // is omitted the edit leaves those links untouched, so fall back to the
    // result's current counts.
    if (project.requireIssueOnFailure) {
      const submittedStatus = await prisma.status.findUnique({
        where: { id: input.statusId },
        select: { isFailure: true },
      });
      const mainIssueCount =
        input.issueIds !== undefined
          ? input.issueIds.length
          : existing.issues.length;
      const existingStepIssueCount = existing.stepResults.reduce(
        (sum, sr) => sum + sr._count.issues,
        0
      );
      const stepIssueCount =
        input.stepIssueCount !== undefined
          ? input.stepIssueCount
          : existingStepIssueCount;
      if (
        failsIssueOnFailureGate({
          requireIssueOnFailure: true,
          hasIssueIntegration: project.projectIntegrations.length > 0,
          statusIsFailure: submittedStatus?.isFailure ?? false,
          linkedIssueCount: mainIssueCount + stepIssueCount,
        })
      ) {
        return NextResponse.json(
          {
            error: "A linked issue is required when the result is a failure",
            code: "ISSUE_REQUIRED_ON_FAILURE",
          },
          { status: 400 }
        );
      }
    }

    // Flip justification — compare the new status to the result's current one.
    if (
      project.requireResultFlipJustification &&
      input.statusId !== existing.statusId &&
      isTiptapEmpty(input.notes)
    ) {
      const statuses = await prisma.status.findMany({
        where: { id: { in: [existing.statusId, input.statusId] } },
        select: {
          id: true,
          isSuccess: true,
          isFailure: true,
          isCompleted: true,
        },
      });
      const priorStatus = statuses.find((s) => s.id === existing.statusId);
      const nextStatus = statuses.find((s) => s.id === input.statusId);
      if (priorStatus && nextStatus && isOutcomeFlip(priorStatus, nextStatus)) {
        return NextResponse.json(
          {
            error:
              "A justification is required when changing the result outcome",
            code: "JUSTIFICATION_REQUIRED",
          },
          { status: 400 }
        );
      }
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

    const evidenceInput: Prisma.InputJsonValue | undefined =
      input.evidence === undefined
        ? undefined
        : input.evidence === null
          ? {}
          : (input.evidence as Prisma.InputJsonValue);

    const existingFieldValueByFieldId = new Map(
      existing.resultFieldValues.map((fv) => [fv.fieldId, fv.id])
    );

    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.testRunResults.findUnique({
        where: { id: input.resultId },
        select: auditableSelect,
      });

      const result = await tx.testRunResults.update({
        where: { id: input.resultId },
        data: {
          statusId: input.statusId,
          notes: notesInput,
          evidence: evidenceInput,
          elapsed: input.elapsed ?? null,
          editedById: user.id,
          editedAt: new Date(),
          ...(input.testRunCaseVersion !== undefined
            ? { testRunCaseVersion: input.testRunCaseVersion }
            : {}),
          ...(input.issueIds !== undefined
            ? { issues: { set: input.issueIds.map((id) => ({ id })) } }
            : {}),
        },
      });

      // Upsert custom field values: update rows that already exist on this
      // result, create the rest. Values arrive already client-encoded.
      for (const fv of input.fieldValues ?? []) {
        const value = (fv.value ?? Prisma.JsonNull) as Prisma.InputJsonValue;
        const existingId = existingFieldValueByFieldId.get(fv.fieldId);
        if (existingId !== undefined) {
          await tx.resultFieldValues.update({
            where: { id: existingId },
            data: { value },
          });
        } else {
          await tx.resultFieldValues.create({
            data: {
              fieldId: fv.fieldId,
              value,
              testRunResultsId: input.resultId,
            },
          });
        }
      }

      const after = await tx.testRunResults.findUnique({
        where: { id: input.resultId },
        select: auditableSelect,
      });

      return { result, before, after };
    });

    // Post-commit, best-effort audit with the before/after diff.
    const changes = calculateDiff(updated.before, updated.after);
    captureAuditEvent({
      action: "UPDATE",
      entityType: "TestRunResults",
      entityId: String(input.resultId),
      projectId: existing.testRunCase.testRun.projectId,
      userId: user.id,
      changes,
      metadata: { testRunCaseId: existing.testRunCaseId },
    }).catch(() => {
      // Audit is best-effort — never block the API response on it.
    });

    return NextResponse.json({ result: updated.result });
  } catch (error) {
    if (
      typeof Prisma?.PrismaClientKnownRequestError === "function" &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Test run result not found", code: "RESULT_NOT_FOUND" },
        { status: 404 }
      );
    }
    console.error("Error editing test run result:", error);
    return NextResponse.json(
      { error: "Failed to edit result", code: "EDIT_RESULT_FAILED" },
      { status: 500 }
    );
  }
}
