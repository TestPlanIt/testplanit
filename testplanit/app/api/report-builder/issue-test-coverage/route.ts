import { NextRequest } from "next/server";
import { handleIssueTestCoveragePOST } from "~/utils/issueTestCoverageUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

async function reportPost(req: NextRequest) {
  return handleIssueTestCoveragePOST(req, false); // false = project-specific
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
