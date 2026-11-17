import { NextRequest } from "next/server";
import {
  handleRequirementReportOptionsGET,
  handleRequirementCoverageReportPOST,
} from "~/utils/requirementCoverageReportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet(req: NextRequest) {
  // Empty dimensions/metrics (specialized report), plus the projects this
  // report can be filtered to.
  return handleRequirementReportOptionsGET(req, true);
}

async function reportPost(req: NextRequest) {
  // The cross-project twin of `requirement-coverage-gaps`: one handler,
  // one shape, ADMIN-gated and anchored on every requirements-enabled
  // project instead of one.
  return handleRequirementCoverageReportPOST(req, "gaps", true);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
