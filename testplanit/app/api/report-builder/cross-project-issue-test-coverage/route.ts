import { NextRequest } from "next/server";
import { handleIssueTestCoveragePOST } from "~/utils/issueTestCoverageUtils";

export async function GET() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

export async function POST(req: NextRequest) {
  return handleIssueTestCoveragePOST(req, true); // true = cross-project
}
