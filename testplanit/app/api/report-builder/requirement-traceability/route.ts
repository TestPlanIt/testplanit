import { NextRequest } from "next/server";
import {
  handleRequirementReportOptionsGET,
  handleRequirementCoverageReportPOST,
} from "~/utils/requirementCoverageReportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet(req: NextRequest) {
  // Empty dimensions/metrics (specialized report), plus this report's
  // filter options.
  return handleRequirementReportOptionsGET(req, false);
}

async function reportPost(req: NextRequest) {
  return handleRequirementCoverageReportPOST(req, "traceability");
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
