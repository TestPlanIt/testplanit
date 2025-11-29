import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { getEnhancedDb } from "@/lib/auth/utils";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      projectId,
      title,
      description,
      priority,
      integrationId,
      testCaseId,
      sessionId,
      testRunId,
      testRunResultId,
      testRunStepResultId,
    } = body;

    if (!projectId || !title) {
      return Response.json(
        { error: "Project ID and title are required" },
        { status: 400 }
      );
    }

    const db = await getEnhancedDb(session);

    // Create the issue
    const issue = await (db as any).issue.create({
      data: {
        name: title, // Use title as name (both are required)
        title,
        description: description || "",
        status: "open",
        priority: priority || "medium",
        project: {
          connect: { id: parseInt(projectId) },
        },
        createdBy: {
          connect: { id: session.user.id },
        },
        // Connect to integration if provided (for Simple URL integrations)
        ...(integrationId && {
          integration: {
            connect: { id: parseInt(integrationId) },
          },
        }),
        // Connect to test entities if provided
        ...(testCaseId && {
          testCase: {
            connect: { id: parseInt(testCaseId) },
          },
        }),
        ...(sessionId && {
          session: {
            connect: { id: parseInt(sessionId) },
          },
        }),
        ...(testRunId && {
          testRun: {
            connect: { id: parseInt(testRunId) },
          },
        }),
        ...(testRunResultId && {
          testRunResult: {
            connect: { id: parseInt(testRunResultId) },
          },
        }),
        ...(testRunStepResultId && {
          testRunStepResult: {
            connect: { id: parseInt(testRunStepResultId) },
          },
        }),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        integration: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
        testCase: {
          select: {
            id: true,
            title: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
          },
        },
        testRun: {
          select: {
            id: true,
            name: true,
          },
        },
        testRunResult: {
          select: {
            id: true,
            status: true,
          },
        },
        testRunStepResult: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    return Response.json(issue);
  } catch (error: any) {
    console.error("Failed to create issue:", error);
    return Response.json(
      { error: error.message || "Failed to create issue" },
      { status: 500 }
    );
  }
}
