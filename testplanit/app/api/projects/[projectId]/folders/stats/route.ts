import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";

interface FolderStats {
  folderId: number;
  directCaseCount: number;
  totalCaseCount: number;
}

export async function GET(
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
      return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const runId = searchParams.get("runId");

    // Verify project exists
    const project = await prisma.projects.findUnique({
      where: { id: projectId, isDeleted: false },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user has access to this project
    const accessibleProjects = await getUserAccessibleProjects(session.user.id);
    const hasAccess = accessibleProjects.some(p => p.projectId === projectId);

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get all folders for the project
    const folders = await prisma.repositoryFolders.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        parentId: true,
      },
    });

    // Build folder hierarchy map
    const childrenMap = new Map<number | null, number[]>();
    folders.forEach((folder: { id: number; parentId: number | null }) => {
      const parentKey = folder.parentId ?? null;
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, []);
      }
      childrenMap.get(parentKey)!.push(folder.id);
    });

    // Get direct case counts per folder
    let directCounts: Map<number, number>;

    if (runId) {
      // For test runs, count test run cases
      const testRunCases = await prisma.testRunCases.findMany({
        where: {
          testRunId: parseInt(runId),
          repositoryCase: {
            isDeleted: false,
          },
        },
        select: {
          repositoryCase: {
            select: {
              folderId: true,
            },
          },
        },
      });

      directCounts = new Map();
      testRunCases.forEach((trc: { repositoryCase: { folderId: number | null } | null }) => {
        const folderId = trc.repositoryCase?.folderId;
        if (folderId) {
          directCounts.set(folderId, (directCounts.get(folderId) || 0) + 1);
        }
      });
    } else {
      // For repository view, count all cases
      const cases = await prisma.repositoryCases.findMany({
        where: {
          projectId,
          isDeleted: false,
        },
        select: {
          folderId: true,
        },
      });

      directCounts = new Map();
      cases.forEach((c) => {
        if (c.folderId !== null) {
          directCounts.set(c.folderId, (directCounts.get(c.folderId) || 0) + 1);
        }
      });
    }

    // Calculate total counts recursively
    const totalCounts = new Map<number, number>();
    const computeTotal = (folderId: number): number => {
      if (totalCounts.has(folderId)) {
        return totalCounts.get(folderId)!;
      }

      let total = directCounts.get(folderId) || 0;
      const children = childrenMap.get(folderId) || [];
      for (const child of children) {
        total += computeTotal(child);
      }

      totalCounts.set(folderId, total);
      return total;
    };

    // Compute totals for all folders
    folders.forEach((folder: { id: number; parentId: number | null }) => {
      computeTotal(folder.id);
    });

    // Build response
    const stats: FolderStats[] = folders.map((folder: { id: number; parentId: number | null }) => ({
      folderId: folder.id,
      directCaseCount: directCounts.get(folder.id) || 0,
      totalCaseCount: totalCounts.get(folder.id) || 0,
    }));

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching folder stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
