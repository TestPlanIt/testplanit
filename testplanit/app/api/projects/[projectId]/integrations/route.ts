import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

const createProjectIntegrationSchema = z.object({
  integrationId: z.number(),
  config: z.record(z.string(), z.any()).optional(),
});

// Helper function to build project access where clause
function buildProjectAccessWhere(
  projectId: number,
  userId: string,
  isAdmin: boolean,
  isProjectAdmin: boolean
) {
  if (isAdmin) {
    return { id: projectId, isDeleted: false };
  }

  return {
    id: projectId,
    isDeleted: false,
    OR: [
      // Direct user permissions
      {
        userPermissions: {
          some: {
            userId: userId,
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
                  userId: userId,
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
                  userId: userId,
                },
              },
            },
          ]
        : []),
    ],
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = parseInt(projectIdParam);

    // Check if user has access to this project
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    const projectAccessWhere = buildProjectAccessWhere(
      projectId,
      session.user.id,
      isAdmin,
      isProjectAdmin
    );

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get project integrations
    const projectIntegrations = await prisma.projectIntegration.findMany({
      where: {
        projectId,
      },
      include: {
        integration: true,
      },
    });

    return NextResponse.json({ projectIntegrations });
  } catch (error) {
    console.error("Error fetching project integrations:", error);
    return NextResponse.json(
      { error: "Failed to fetch project integrations" },
      { status: 500 }
    );
  }
}

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);

      // Check if user has Manager or Admin access to this project
      const isAdmin = session.user.access === "ADMIN";
      const isProjectAdmin = session.user.access === "PROJECTADMIN";

      const projectAccessWhere = buildProjectAccessWhere(
        projectId,
        session.user.id,
        isAdmin,
        isProjectAdmin
      );

      const project = await prisma.projects.findFirst({
        where: projectAccessWhere,
      });

      if (!project) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
        );
      }

      const body = await request.json();
      const validatedData = createProjectIntegrationSchema.parse(body);

      // Check if integration exists and is active
      const integration = await prisma.integration.findFirst({
        where: {
          id: validatedData.integrationId,
          status: "ACTIVE",
          isDeleted: false,
        },
      });

      if (!integration) {
        return NextResponse.json(
          { error: "Integration not found or inactive" },
          { status: 404 }
        );
      }

      // Capture the project's currently-active integration provider BEFORE
      // any deactivate/reactivate calls. If the provider changes, any
      // inbound webhook on the project is now orphaned (its adapterType is
      // locked to the old provider, so events would route into deadweight).
      // Hard-delete those rows post-switch — see cascade below.
      const priorActiveProjectIntegration =
        await prisma.projectIntegration.findFirst({
          where: { projectId, isActive: true },
          include: { integration: { select: { provider: true } } },
        });
      const priorProvider =
        priorActiveProjectIntegration?.integration?.provider ?? null;

      // Check if this integration was previously assigned to the project
      const existingProjectIntegration =
        await prisma.projectIntegration.findFirst({
          where: {
            projectId,
            integrationId: validatedData.integrationId,
          },
        });

      let projectIntegration;

      if (existingProjectIntegration) {
        // Deactivate other project integrations
        await prisma.projectIntegration.updateMany({
          where: {
            projectId,
            isActive: true,
            NOT: {
              id: existingProjectIntegration.id,
            },
          },
          data: {
            isActive: false,
          },
        });

        // Reactivate the existing integration
        projectIntegration = await prisma.projectIntegration.update({
          where: {
            id: existingProjectIntegration.id,
          },
          data: {
            isActive: true,
            config:
              validatedData.config || existingProjectIntegration.config || {},
          },
          include: {
            integration: true,
          },
        });
      } else {
        // Deactivate existing project integrations
        await prisma.projectIntegration.updateMany({
          where: {
            projectId,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        // Create new project integration
        projectIntegration = await prisma.projectIntegration.create({
          data: {
            projectId,
            integrationId: validatedData.integrationId,
            config: validatedData.config || {},
            isActive: true,
          },
          include: {
            integration: true,
          },
        });
      }

      // If the active integration's provider changed, any inbound webhook
      // configured for the project is locked to the OLD provider's adapter
      // and would silently drop or auto-create orphan rows after the
      // switch. Hard-delete to keep the inbound webhook 1:1 with the
      // project's assigned issue integration. WebhookConfig has no
      // soft-delete column; FK cascades clean up dedup + secrets rows
      // (deliveries SetNull-cascade, retained for audit history).
      if (priorProvider !== integration.provider) {
        await prisma.webhookConfig.deleteMany({
          where: { projectId, direction: "INBOUND" },
        });
      }

      return NextResponse.json({ projectIntegration });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }

      console.error("Error creating project integration:", error);
      return NextResponse.json(
        { error: "Failed to create project integration" },
        { status: 500 }
      );
    }
  }
);
