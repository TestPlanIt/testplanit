import { NextRequest } from "next/server";
import { handleRequirementCoverageChangesPOST } from "~/utils/requirementCoverageReportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

async function reportPost(req: NextRequest) {
  return handleRequirementCoverageChangesPOST(req);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
