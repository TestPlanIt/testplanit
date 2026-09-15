import { NextRequest } from "next/server";
import { handleImpactAnalysisReportPOST } from "~/utils/impactAnalysisReportUtils";

export async function GET() {
  // A pre-built report: no dimension or metric selection.
  return Response.json({ dimensions: [], metrics: [] });
}

export async function POST(req: NextRequest) {
  return handleImpactAnalysisReportPOST(req, true);
}
