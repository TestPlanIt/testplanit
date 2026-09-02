import { NextRequest } from "next/server";
import {
  handleRequirementReportOptionsGET,
  handleRequirementCoverageReportPOST,
} from "~/utils/requirementCoverageReportUtils";

export async function GET(req: NextRequest) {
  // Empty dimensions/metrics (specialized report), plus the projects this
  // report can be filtered to.
  return handleRequirementReportOptionsGET(req, true);
}

export async function POST(req: NextRequest) {
  // The cross-project twin of `requirement-traceability`: one handler, one
  // shape, ADMIN-gated and anchored on every requirements-enabled project
  // instead of one.
  return handleRequirementCoverageReportPOST(req, "traceability", true);
}
