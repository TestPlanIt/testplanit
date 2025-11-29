import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { z } from "zod/v4";

// Schema for fetch many request
const fetchManyCasesSchema = z.object({
  caseIds: z.array(z.number()),
  skip: z.number().optional(),
  take: z.number().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
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
    const project = isAdmin
      ? await prisma.projects.findUnique({
          where: { id: projectId, isDeleted: false },
        })
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
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = fetchManyCasesSchema.parse(body);

    const whereClause = {
      id: { in: validatedData.caseIds },
      projectId,
      isDeleted: false,
      isArchived: false,
    };

    // Get total count
    const totalCount = validatedData.caseIds.length;

    // Apply pagination: slice the caseIds array first to maintain order
    const paginatedCaseIds = validatedData.skip !== undefined && validatedData.take !== undefined
      ? validatedData.caseIds.slice(validatedData.skip, validatedData.skip + validatedData.take)
      : validatedData.caseIds;

    // Fetch the cases with all necessary includes
    const cases = await prisma.repositoryCases.findMany({
      where: {
        id: { in: paginatedCaseIds },
        projectId,
        isDeleted: false,
        isArchived: false,
      },
      include: {
        state: {
          include: {
            icon: true,
            color: true,
          },
        },
        project: true,
        folder: true,
        creator: true,
        template: {
          include: {
            caseFields: {
              orderBy: { order: "asc" },
              include: {
                caseField: {
                  include: {
                    type: true,
                    fieldOptions: {
                      orderBy: { fieldOption: { order: "asc" } },
                      include: {
                        fieldOption: {
                          include: { icon: true, iconColor: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        caseFieldValues: {
          include: {
            field: { include: { type: true } },
          },
        },
        tags: true,
        issues: true,
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
        },
        attachments: {
          where: { isDeleted: false },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Maintain the original order from caseIds
    const orderedCases = paginatedCaseIds
      .map(id => cases.find(c => c.id === id))
      .filter(c => c !== undefined);

    return NextResponse.json({ cases: orderedCases, totalCount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error fetching cases:", error);
    return NextResponse.json(
      { error: "Failed to fetch cases" },
      { status: 500 }
    );
  }
}
