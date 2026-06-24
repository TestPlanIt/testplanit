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
    const issue = await (db as any).issue.findFirst({
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

    // Disconnect the entity link
    // Relation field names must match the Issue model in schema.zmodel:
    // caseIssues (explicit join to RepositoryCases), sessions, testRuns,
    // testRunResults, testRunStepResults
    const includeArg = {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    };

    // The RepositoryCases <-> Issue relation is an explicit join model
    // (RepositoryCaseIssue), so unlinking a test case is a deleteMany on the
    // join rather than a disconnect on the Issue relation.
    if (entityType === "testCase") {
      await (db as any).repositoryCaseIssue.deleteMany({
        where: { issueId, caseId: parseInt(entityId) },
      });

      const updatedIssue = await (db as any).issue.findUnique({
        where: { id: issueId },
        include: includeArg,
      });

      return NextResponse.json(updatedIssue);
    }

    const updateData: any = {};
    switch (entityType) {
      case "session":
        updateData.sessions = { disconnect: { id: parseInt(entityId) } };
        break;
      case "testRun":
        updateData.testRuns = { disconnect: { id: parseInt(entityId) } };
        break;
      case "testRunResult":
        updateData.testRunResults = { disconnect: { id: parseInt(entityId) } };
        break;
      case "testRunStepResult":
        updateData.testRunStepResults = {
          disconnect: { id: parseInt(entityId) },
        };
        break;
      default:
        return NextResponse.json(
          { error: "Invalid entity type" },
          { status: 400 }
        );
    }

    const updatedIssue = await (db as any).issue.update({
      where: { id: issueId },
      data: updateData,
      include: includeArg,
    });

    return NextResponse.json(updatedIssue);
  } catch (error: any) {
    console.error("Error unlinking issue:", error);
    return NextResponse.json(
      { error: error.message || "Failed to unlink issue" },
      { status: 500 }
    );
  }
}
