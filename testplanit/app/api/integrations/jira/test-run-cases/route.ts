import { baseDb as db } from "@/lib/db";
import {
  collectPanelTestRunIds,
  getTestRunDisplayItems,
  panelIssueLinkSelect,
  panelIssueWhere,
} from "~/lib/services/jiraForgePanel";
import { authenticateForgeIntegration } from "~/lib/services/forge-jira-auth";
import { NextRequest, NextResponse } from "next/server";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Forge-Api-Key",
};

// One linked run's per-case status-bar segments for the Jira issue panel,
// fetched when the user expands the run instead of with the panel's initial
// load. Only runs linked to the issue are served, so the Forge key reaches
// exactly what test-info already shows for that issue.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const issueKey = searchParams.get("issueKey");
  const issueId = searchParams.get("issueId");
  const testRunId = Number(searchParams.get("testRunId"));

  if (!issueKey && !issueId) {
    return NextResponse.json(
      { error: "issueKey or issueId is required" },
      { status: 400, headers }
    );
  }
  if (!Number.isInteger(testRunId) || testRunId <= 0) {
    return NextResponse.json(
      { error: "testRunId is required" },
      { status: 400, headers }
    );
  }

  try {
    const authenticatedIntegration = await authenticateForgeIntegration(
      request.headers.get("X-Forge-Api-Key")
    );
    if (!authenticatedIntegration) {
      return NextResponse.json(
        {
          error:
            "Invalid or missing API key. Configure a Forge API key in your Jira integration settings.",
        },
        { status: 401, headers }
      );
    }

    const issues = await db.issue.findMany({
      where: panelIssueWhere(issueKey, issueId),
      select: panelIssueLinkSelect,
    });
    if (!collectPanelTestRunIds(issues).includes(testRunId)) {
      return NextResponse.json(
        { error: "Test run is not linked to this issue" },
        { status: 404, headers }
      );
    }

    const itemsByRun = await getTestRunDisplayItems([testRunId]);
    return NextResponse.json(
      { displayItems: itemsByRun.get(testRunId) ?? [] },
      { headers }
    );
  } catch (error) {
    console.error("Error fetching test run cases:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}
