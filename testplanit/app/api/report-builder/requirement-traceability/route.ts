import { NextRequest } from "next/server";
import { handleRequirementCoverageReportPOST } from "~/utils/requirementCoverageReportUtils";

export async function GET() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

export async function POST(req: NextRequest) {
  return handleRequirementCoverageReportPOST(req, "traceability");
}
