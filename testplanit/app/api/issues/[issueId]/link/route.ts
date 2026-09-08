import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { entityType, entityId } = await req.json();
    const { issueId: issueIdParam } = await params;
    const issueId = parseInt(issueIdParam);

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "Entity type and ID are required" },
        { status: 400 }
      );
    }

    const db = await getEnhancedDb(session);

    // Verify the issue exists and user has access
    const issue = await db.issue.findFirst({
      where: {
        id: issueId,
      },
    });

    if (!issue) {
      return NextResponse.json(
        { error: "Issue not found or access denied" },
        { status: 404 }
      );
    }

    // Update the issue with the entity link
    // Relation field names must match the Issue model in schema.zmodel:
    // caseIssues (join), sessions, testRuns, testRunResults, testRunStepResults
    if (entityType === "testCase") {
      // RepositoryCases <-> Issue is an explicit join model (RepositoryCaseIssue).
      // Create the join row instead of connecting through an implicit relation.
      await db.repositoryCaseIssue.create({
        data: { issueId, caseId: parseInt(entityId) },
      });
    } else {
      const updateData: any = {};
      switch (entityType) {
        case "session":
          updateData.sessions = { connect: { id: parseInt(entityId) } };
          break;
        case "testRun":
          updateData.testRuns = { connect: { id: parseInt(entityId) } };
          break;
        case "testRunResult":
          updateData.testRunResults = { connect: { id: parseInt(entityId) } };
          break;
        case "testRunStepResult":
          updateData.testRunStepResults = {
            connect: { id: parseInt(entityId) },
          };
          break;
        default:
          return NextResponse.json(
            { error: "Invalid entity type" },
            { status: 400 }
          );
      }

      await db.issue.update({
        where: { id: issueId },
        data: updateData,
      });
    }

    const updatedIssue = await db.issue.findUnique({
      where: { id: issueId },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(updatedIssue);
  } catch (error: any) {
    console.error("Error linking issue:", error);
    return NextResponse.json(
      { error: error.message || "Failed to link issue" },
      { status: 500 }
    );
  }
}
