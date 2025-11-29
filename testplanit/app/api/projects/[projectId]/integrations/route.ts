import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { z } from "zod/v4";

const createProjectIntegrationSchema = z.object({
  integrationId: z.number(),
  config: z.record(z.string(), z.any()).optional(),
});

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

    const project = isAdmin
      ? await prisma.projects.findUnique({ where: { id: projectId, isDeleted: false } })
      : await prisma.projects.findFirst({
          where: {
            id: projectId,
            isDeleted: false,
            userPermissions: {
              some: {
                userId: session.user.id,
              },
            },
          },
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

export async function POST(
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

    // Check if user has Manager or Admin access to this project
    const isSystemAdmin = session.user.access === "ADMIN" || session.user.access === "PROJECTADMIN";

    const project = isSystemAdmin
      ? await prisma.projects.findUnique({ where: { id: projectId, isDeleted: false } })
      : await prisma.projects.findFirst({
          where: {
            id: projectId,
            isDeleted: false,
            userPermissions: {
              some: {
                userId: session.user.id,
              },
            },
          },
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
    const integration = await db.integration.findFirst({
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

    // Check if this integration was previously assigned to the project
    const existingProjectIntegration = await db.projectIntegration.findFirst({
      where: {
        projectId,
        integrationId: validatedData.integrationId,
      },
    });

    let projectIntegration;

    if (existingProjectIntegration) {
      // Deactivate other project integrations
      await db.projectIntegration.updateMany({
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
      projectIntegration = await db.projectIntegration.update({
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
      await db.projectIntegration.updateMany({
        where: {
          projectId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Create new project integration
      projectIntegration = await db.projectIntegration.create({
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
