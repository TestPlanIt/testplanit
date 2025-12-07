import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { ProjectAccessType } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const issueKey = searchParams.get("issueKey");

    if (!projectId || !issueKey) {
      return NextResponse.json(
        { error: "Missing projectId or issueKey parameter" },
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
      ? { id: parseInt(projectId), isDeleted: false }
      : {
          id: parseInt(projectId),
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
      include: {
        projectIntegrations: {
          where: { isActive: true },
          include: {
            integration: true,
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const activeIntegration = project.projectIntegrations[0];
    if (!activeIntegration) {
      return NextResponse.json(
        { error: "No active integration found" },
        { status: 400 }
      );
    }

    // Fetch issue details based on the integration provider
    if (activeIntegration.integration.provider === "JIRA") {
      // For now, return mock data since we don't have full Jira integration
      return NextResponse.json({
        success: true,
        issue: {
          key: issueKey,
          summary: `Issue ${issueKey}`,
          description: `This is a detailed description for issue ${issueKey}. It includes requirements and acceptance criteria that would normally be fetched from Jira.`,
          status: "Open",
          priority: "Medium", 
          issueType: "Story",
          comments: [
            {
              author: "Product Owner",
              body: "Please ensure we cover all edge cases in testing this feature.",
              created: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            },
            {
              author: "Developer", 
              body: "Implementation notes: This will require changes to the permissions system.",
              created: new Date(Date.now() - 43200000).toISOString(), // 12 hours ago
            }
          ],
        },
      });
    } else {
      // For other integration types, return basic info
      // This can be extended to support other providers like Azure DevOps, etc.
      return NextResponse.json({
        success: true,
        issue: {
          key: issueKey,
          summary: "Issue details not available for this integration type",
          description: null,
          status: "Unknown",
          priority: null,
          issueType: "Unknown",
          comments: [],
        },
      });
    }
  } catch (error) {
    console.error("Error in GET /api/integrations/issue-details:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    return NextResponse.json(
      { error: "Failed to fetch issue details", details: errorMessage },
      { status: 500 }
    );
  }
}