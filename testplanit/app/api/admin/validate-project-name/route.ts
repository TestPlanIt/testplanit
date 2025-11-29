import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Only admins can create projects and need name validation
    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, excludeId } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 }
      );
    }

    // Use raw Prisma query to bypass ZenStack access rules
    // This checks ALL projects including deleted ones
    const existingProject = await db.projects.findFirst({
      where: {
        name: {
          equals: name,
          mode: "insensitive", // Case-insensitive comparison
        },
        ...(excludeId && { NOT: { id: excludeId } }), // Exclude current project if editing
      },
      select: {
        id: true,
        name: true,
        isDeleted: true,
      },
    });

    if (existingProject) {
      return NextResponse.json(
        {
          isUnique: false,
          message: existingProject.isDeleted
            ? "This name was used by a deleted project. Please choose a different name."
            : "A project with this name already exists.",
          conflictingProject: {
            id: existingProject.id,
            name: existingProject.name,
            isDeleted: existingProject.isDeleted,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        isUnique: true,
        message: "Project name is available",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error validating project name:", error);
    return NextResponse.json(
      { error: "Failed to validate project name" },
      { status: 500 }
    );
  }
}