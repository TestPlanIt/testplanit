import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { z } from "zod/v4";

const updateProjectIntegrationSchema = z.object({
  config: z.record(z.string(), z.any()),
});

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ projectId: string; integrationProjectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, integrationProjectId } = await params;
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
    const validatedData = updateProjectIntegrationSchema.parse(body);

    // Update project integration settings
    const projectIntegration = await prisma.projectIntegration.update({
      where: {
        id: integrationProjectId,
        projectId,
      },
      data: {
        config: validatedData.config,
        updatedAt: new Date(),
      },
      include: {
        integration: true,
      },
    });

    return NextResponse.json({ projectIntegration });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error updating project integration:", error);
    return NextResponse.json(
      { error: "Failed to update project integration" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ projectId: string; integrationProjectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, integrationProjectId } = await params;
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

    // Delete project integration
    await prisma.projectIntegration.delete({
      where: {
        id: integrationProjectId,
        projectId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project integration:", error);
    return NextResponse.json(
      { error: "Failed to delete project integration" },
      { status: 500 }
    );
  }
}
