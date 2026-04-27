import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import {
  getTestRunSummary,
  TestRunNotFoundError,
} from "~/lib/services/testRunSummary";
import { authOptions } from "~/server/auth";

export type { TestRunSummaryData } from "~/lib/services/testRunSummary";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ testRunId: string }> }
) {
  const { testRunId: testRunIdParam } = await params;
  const testRunId = Number(testRunIdParam);

  if (isNaN(testRunId)) {
    return NextResponse.json({ error: "Invalid test run ID" }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const includeCaseDetails = searchParams.get("includeCaseDetails") === "true";

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await getTestRunSummary(testRunId, { includeCaseDetails });
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof TestRunNotFoundError) {
      return NextResponse.json(
        { error: "Test run not found" },
        { status: 404 }
      );
    }
    console.error("Test run summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test run summary" },
      { status: 500 }
    );
  }
}
