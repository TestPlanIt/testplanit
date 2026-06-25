import { baseDb } from "@/lib/db";
import { ProjectAccessType } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { generateTestCasesForProject } from "./core";
import type { GenerationContext, IssueData, TemplateData } from "./shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      projectId,
      issue,
      template,
      context,
      quantity,
      autoGenerateTags,
      includeParameters,
    } = body as {
      projectId: number;
      issue: IssueData;
      template: TemplateData;
      context: GenerationContext;
      quantity?: string;
      autoGenerateTags?: boolean;
      includeParameters?: boolean;
    };

    if (!projectId || !issue || !template) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Verify user has access to the project and check for active LLM integration
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // CR-03 (T-06-04-01): server-side admin gate on the
    // `includeParameters` flag. The wizard hides the toggle for
    // non-admins, but a crafted request body must still be rejected
    // here — the UI guard is defense-in-depth, not the authority.
    if (includeParameters === true && !isAdmin) {
      return NextResponse.json(
        {
          error: "Admin access required for includeParameters",
          code: "FORBIDDEN_PARAMETER_GENERATION",
        },
        { status: 403 }
      );
    }

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

    const project = await baseDb.projects.findFirst({
      where: projectAccessWhere,
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const outcome = await generateTestCasesForProject({
      projectId,
      issue,
      template,
      context,
      quantity,
      autoGenerateTags,
      includeParameters,
      userId: session.user.id,
    });

    if (!outcome.ok) {
      return NextResponse.json(outcome.body, { status: outcome.status });
    }

    return NextResponse.json({
      success: true,
      testCases: outcome.testCases,
      ...(outcome.warnings && outcome.warnings.length > 0
        ? { warnings: outcome.warnings }
        : {}),
      metadata: outcome.metadata,
    });
  } catch (error) {
    console.error("Error in POST /api/llm/generate-test-cases:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate test cases";
    const errorStack = error instanceof Error ? error.stack : "";

    return NextResponse.json(
      {
        error: "Failed to generate test cases",
        details: errorMessage,
        stack: errorStack?.substring(0, 1000), // Include stack trace for debugging
      },
      { status: 500 }
    );
  }
}
