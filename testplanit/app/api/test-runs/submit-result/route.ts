import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

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
});

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
  return Boolean(role?.rolePermissions?.some((permission) => permission.canAddEdit));
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
      project.assignedUsers.some((assignment) => assignment.userId === user.id) &&
      roleCanAddEditTestRunResults(project.defaultRole)
    );
  }

  return false;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        id: session.user.id,
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
        testRun: {
          select: {
            id: true,
            createdById: true,
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

    const result = await prisma.$transaction(async (tx) => {
      const createdResult = await tx.testRunResults.create({
        data: {
          testRunId: input.testRunId,
          testRunCaseId: input.testRunCaseId,
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

      await tx.testRunCases.update({
        where: {
          id: input.testRunCaseId,
        },
        data: {
          statusId: input.statusId,
        },
      });

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
        }
      }

      return createdResult;
    });

    return NextResponse.json({ result });
  } catch (error) {
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
