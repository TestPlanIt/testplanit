import { NextRequest } from "next/server";
import {
  handleRequirementReportOptionsGET,
  handleRequirementCoverageReportPOST,
} from "~/utils/requirementCoverageReportUtils";

export async function GET(req: NextRequest) {
  // Empty dimensions/metrics (specialized report), plus this report's
  // filter options.
  return handleRequirementReportOptionsGET(req, false);
}

export async function POST(req: NextRequest) {
  return handleRequirementCoverageReportPOST(req, "gaps");
}
