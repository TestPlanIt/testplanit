import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { prisma } from "~/lib/prisma";
import { auditBulkUpdate } from "~/lib/services/auditLog";
import { assertReviewGatePasses } from "~/lib/services/reviewGate";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import {
  isAlreadyPendingError,
  isReviewGateError,
  ReviewGateError,
} from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

// Schema for bulk edit request
const bulkEditSchema = z.object({
  caseIds: z.array(z.number()),
  updates: z.object({
    // Standard fields
    name: z.string().optional(),
    state: z.number().optional(),
    automated: z.boolean().optional(),
    estimate: z.number().optional(),
    tags: z
      .object({
        connect: z.array(z.object({ id: z.number() })).optional(),
        disconnect: z.array(z.object({ id: z.number() })).optional(),
      })
      .optional(),
    issues: z
      .object({
        connect: z.array(z.object({ id: z.number() })).optional(),
        disconnect: z.array(z.object({ id: z.number() })).optional(),
      })
      .optional(),
  }),
  customFieldUpdates: z
    .array(
      z.object({
        fieldId: z.number(),
        value: z.any(),
        operation: z.enum(["create", "update", "delete"]),
      })
    )
    .optional(),
  stepsUpdates: z
    .object({
      operation: z.enum(["replace", "search-replace"]),
      searchPattern: z.string().optional(),
      replacePattern: z.string().optional(),
      searchOptions: z
        .object({
          useRegex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
        })
        .optional(),
      newSteps: z
        .array(
          z.object({
            step: z.any(),
            expectedResult: z.any(),
            order: z.number(),
          })
        )
        .optional(),
    })
    .optional(),
  createVersions: z.boolean().default(true),
});

type BulkEditRequest = z.infer<typeof bulkEditSchema>;

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid project ID" },
          { status: 400 }
        );
      }

      // Verify user has access to the project
      const isAdmin = session.user.access === "ADMIN";
      const isProjectAdmin = session.user.access === "PROJECTADMIN";

      // Build the where clause for project access
      // This needs to account for all access paths: userPermissions, groupPermissions,
      // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
      const projectAccessWhere = isAdmin
        ? { id: projectId, isDeleted: false }
        : {
            id: projectId,
            isDeleted: false,
            OR: [
              // Direct user permissions
              {
                userPermissions: {
                  some: {
                    userId: session.user.id,
                    accessType: { not: ProjectAccessType.NO_ACCESS },
                  },
                },
              },
              // Group permissions
              {
                groupPermissions: {
                  some: {
                    group: {
                      assignedUsers: {
                        some: {
                          userId: session.user.id,
                        },
                      },
                    },
                    accessType: { not: ProjectAccessType.NO_ACCESS },
                  },
                },
              },
              // Project default GLOBAL_ROLE (any authenticated user with a role)
              {
                defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
              },
              // Direct assignment to project with PROJECTADMIN access
              ...(isProjectAdmin
                ? [
                    {
                      assignedUsers: {
                        some: {
                          userId: session.user.id,
                        },
                      },
                    },
                  ]
                : []),
            ],
          };

      const project = await prisma.projects.findFirst({
        where: projectAccessWhere,
      });

      if (!project) {
        return NextResponse.json(
          { error: "Project not found or access denied" },
          { status: 404 }
        );
      }

      // Parse and validate request body
      const body = await request.json();
      const validatedData: BulkEditRequest = bulkEditSchema.parse(body);

      // Verify all cases belong to this project
      const cases = await prisma.repositoryCases.findMany({
        where: {
          id: { in: validatedData.caseIds },
          projectId,
          isDeleted: false,
        },
        include: {
          steps: {
            where: { isDeleted: false },
            orderBy: { order: "asc" },
          },
          tags: true,
          issues: true,
          caseFieldValues: true,
          project: true,
          folder: true,
          template: true,
          state: true,
          creator: true,
        },
      });

      if (cases.length !== validatedData.caseIds.length) {
        return NextResponse.json(
          {
            error: "Some cases not found or do not belong to this project",
          },
          { status: 400 }
        );
      }

      // Perform bulk update in a transaction with extended timeout (60 seconds).
      // auditedTransaction sets app.audit_context once at the transaction
      // boundary so every row this writes — the case AND its child/value tables
      // (CaseFieldValues, Steps, versions) — is attributed to the actor.
      const result = await auditedTransaction(
        async (tx) => {
          const updateResults = {
            casesUpdated: 0,
            versionsCreated: 0,
            customFieldsUpdated: 0,
            stepsUpdated: 0,
          };

          // Process each case for updates
          for (const caseItem of cases) {
            const caseId = caseItem.id;

            // Build update data for standard fields
            const updateData: any = {
              currentVersion: { increment: 1 },
            };

            if (validatedData.updates.name !== undefined) {
              updateData.name = validatedData.updates.name;
            }
            if (validatedData.updates.state !== undefined) {
              updateData.stateId = validatedData.updates.state;
            }
            if (validatedData.updates.automated !== undefined) {
              updateData.automated = validatedData.updates.automated;
            }
            if (validatedData.updates.estimate !== undefined) {
              updateData.estimate = validatedData.updates.estimate;
            }
            if (validatedData.updates.tags) {
              updateData.tags = validatedData.updates.tags;
            }
            if (validatedData.updates.issues) {
              updateData.issues = validatedData.updates.issues;
            }

            // Review & Approval preflight (Plan 01-04). When the bulk edit
            // includes a stateId change, assert the target state's review
            // gate passes for this specific case BEFORE the update fires.
            // The bulk-edit route uses raw prisma (not the auto-API), so the
            // schema `@@deny` rule does NOT fire here — this app preflight is
            // the sole gate. A throw inside `prisma.$transaction` rolls back
            // every prior case in the loop; partial-bulk semantics ("fail
            // closed") are correct for Phase 1.
            let gateApprovals: { approvedRequestIds: string[] } | null = null;
            if (updateData.stateId !== undefined) {
              gateApprovals = await assertReviewGatePasses(
                tx,
                "CASE",
                caseId,
                updateData.stateId
              );
            }

            // Update the case
            await tx.repositoryCases.update({
              where: { id: caseId },
              data: updateData,
            });
            updateResults.casesUpdated++;

            // Strict transitive gates can return multiple approvals when one
            // transition crosses several gates. Stamp every returned id in
            // one updateMany; a short count means another caller raced us on
            // at least one approval — surface that as REVIEW_REQUIRED so the
            // whole transaction rolls back and the client gets the typed 403.
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
                  "CASE",
                  caseId,
                  updateData.stateId!
                );
              }
            }

            // Handle custom field updates
            if (validatedData.customFieldUpdates) {
              for (const fieldUpdate of validatedData.customFieldUpdates) {
                const existingFieldValue = caseItem.caseFieldValues.find(
                  (cfv) => cfv.fieldId === fieldUpdate.fieldId
                );

                if (fieldUpdate.operation === "delete" && existingFieldValue) {
                  await tx.caseFieldValues.delete({
                    where: { id: existingFieldValue.id },
                  });
                  updateResults.customFieldsUpdated++;
                } else if (fieldUpdate.operation === "update") {
                  // Upsert: update if exists, create if doesn't
                  if (existingFieldValue) {
                    await tx.caseFieldValues.update({
                      where: { id: existingFieldValue.id },
                      data: { value: fieldUpdate.value },
                    });
                  } else {
                    await tx.caseFieldValues.create({
                      data: {
                        testCaseId: caseId,
                        fieldId: fieldUpdate.fieldId,
                        value: fieldUpdate.value,
                      },
                    });
                  }
                  updateResults.customFieldsUpdated++;
                } else if (fieldUpdate.operation === "create") {
                  await tx.caseFieldValues.create({
                    data: {
                      testCaseId: caseId,
                      fieldId: fieldUpdate.fieldId,
                      value: fieldUpdate.value,
                    },
                  });
                  updateResults.customFieldsUpdated++;
                }
              }
            }

            // Handle steps updates
            if (validatedData.stepsUpdates) {
              if (validatedData.stepsUpdates.operation === "replace") {
                // Delete existing steps
                await tx.steps.deleteMany({
                  where: { testCaseId: caseId },
                });

                // Create new steps
                if (validatedData.stepsUpdates.newSteps) {
                  for (const stepData of validatedData.stepsUpdates.newSteps) {
                    await tx.steps.create({
                      data: {
                        testCaseId: caseId,
                        step: JSON.stringify(stepData.step),
                        expectedResult: JSON.stringify(stepData.expectedResult),
                        order: stepData.order,
                      },
                    });
                  }
                  updateResults.stepsUpdated++;
                }
              } else if (
                validatedData.stepsUpdates.operation === "search-replace"
              ) {
                // For search-replace, we need to update each step individually
                const searchPattern =
                  validatedData.stepsUpdates.searchPattern || "";
                const replacePattern =
                  validatedData.stepsUpdates.replacePattern || "";
                const useRegex =
                  validatedData.stepsUpdates.searchOptions?.useRegex || false;
                const caseSensitive =
                  validatedData.stepsUpdates.searchOptions?.caseSensitive ||
                  false;

                for (const step of caseItem.steps) {
                  let updatedStep = step.step;
                  let updatedExpectedResult = step.expectedResult;

                  // Apply search/replace transformation
                  if (step.step && typeof step.step === "string") {
                    updatedStep = applySearchReplace(
                      step.step,
                      searchPattern,
                      replacePattern,
                      useRegex,
                      caseSensitive
                    );
                  }
                  if (
                    step.expectedResult &&
                    typeof step.expectedResult === "string"
                  ) {
                    updatedExpectedResult = applySearchReplace(
                      step.expectedResult,
                      searchPattern,
                      replacePattern,
                      useRegex,
                      caseSensitive
                    );
                  }

                  await tx.steps.update({
                    where: { id: step.id },
                    data: {
                      step: updatedStep as any,
                      expectedResult: updatedExpectedResult as any,
                    },
                  });
                }
                updateResults.stepsUpdated++;
              }
            }

            // Create version snapshot if requested
            // Note: The test case was already updated with currentVersion incremented above
            if (validatedData.createVersions) {
              await createTestCaseVersionInTransaction(tx, caseId, {
                // Preserve original creator metadata
                creatorId: caseItem.creatorId,
                creatorName: caseItem.creator?.name || "",
                createdAt: caseItem.createdAt,
                overrides: {
                  // Apply any changes from the bulk edit
                  name: updateData.name ?? caseItem.name,
                  stateId: updateData.stateId ?? caseItem.stateId,
                  automated: updateData.automated ?? caseItem.automated,
                  estimate: updateData.estimate ?? caseItem.estimate,
                  // stateName, tags, issues, and steps are intentionally NOT
                  // overridden here. The version service re-reads them from the
                  // row we just updated inside this same transaction, so the
                  // snapshot reflects this bulk edit's state, connect/disconnect
                  // and step changes. Passing the in-memory pre-update
                  // `caseItem` values would record stale data on the version
                  // (e.g. the old state name for a just-changed state).
                  isArchived: caseItem.isArchived,
                  order: caseItem.order,
                },
              });
              updateResults.versionsCreated++;
            }
          }

          return updateResults;
        },
        {
          timeout: 60000, // 60 seconds timeout for large bulk operations
        }
      );

      // Audit the bulk update
      if (result.casesUpdated > 0) {
        await auditBulkUpdate(
          "RepositoryCases",
          result.casesUpdated,
          { caseIds: validatedData.caseIds },
          projectId
        );
      }

      return NextResponse.json({
        success: true,
        result,
      });
    } catch (error) {
      // Review & Approval (Plan 01-04): translate typed errors thrown from
      // assertReviewGatePasses into structured 403 / 409 responses BEFORE
      // the generic-error fallback. Detector order: ReviewGateError comes
      // from this route's preflight; AlreadyPendingError will surface from
      // ReviewRequest create paths landing in Phase 2.
      if (isReviewGateError(error)) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              entityType: error.entityType,
              entityId: error.entityId,
              toStateId: error.toStateId,
            },
          },
          { status: 403 }
        );
      }
      if (isAlreadyPendingError(error)) {
        return NextResponse.json(
          { error: { code: "PENDING_REVIEW_EXISTS" } },
          { status: 409 }
        );
      }

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }

      console.error("Error performing bulk edit:", error);
      return NextResponse.json(
        { error: "Failed to perform bulk edit" },
        { status: 500 }
      );
    }
  }
);

// Helper function to apply search/replace to TipTap JSON content
function applySearchReplace(
  content: string,
  searchPattern: string,
  replacePattern: string,
  useRegex: boolean,
  caseSensitive: boolean
): string {
  try {
    const json = typeof content === "string" ? JSON.parse(content) : content;

    const transformNode = (node: any): any => {
      if (node.type === "text" && node.text) {
        let text = node.text;

        if (useRegex) {
          const flags = caseSensitive ? "g" : "gi";
          const regex = new RegExp(searchPattern, flags);
          text = text.replace(regex, replacePattern);
        } else {
          const search = caseSensitive
            ? searchPattern
            : searchPattern.toLowerCase();
          const target = caseSensitive ? text : text.toLowerCase();

          if (target.includes(search)) {
            const parts = [];
            let lastIndex = 0;
            const targetText = text;
            const lowerTarget = target;

            let index = lowerTarget.indexOf(search, lastIndex);
            while (index !== -1) {
              if (index > lastIndex) {
                parts.push(targetText.substring(lastIndex, index));
              }
              parts.push(replacePattern);
              lastIndex = index + searchPattern.length;
              index = lowerTarget.indexOf(search, lastIndex);
            }
            if (lastIndex < targetText.length) {
              parts.push(targetText.substring(lastIndex));
            }
            text = parts.join("");
          }
        }

        return { ...node, text };
      }

      if (node.content) {
        return {
          ...node,
          content: node.content.map(transformNode),
        };
      }

      return node;
    };

    const transformed = transformNode(json);
    return JSON.stringify(transformed);
  } catch (e) {
    console.error("Error applying search/replace:", e);
    return content;
  }
}
