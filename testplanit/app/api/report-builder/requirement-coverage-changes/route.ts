import { NextRequest } from "next/server";
import { handleRequirementCoverageChangesPOST } from "~/utils/requirementCoverageReportUtils";

export async function GET() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

export async function POST(req: NextRequest) {
  return handleRequirementCoverageChangesPOST(req);
}
