import { NextRequest } from "next/server";
import { handleCodePinCoverageReportPOST } from "~/utils/codePinCoverageReportUtils";

export async function GET() {
  // A pre-built report: no dimension or metric selection.
  return Response.json({ dimensions: [], metrics: [] });
}

export async function POST(req: NextRequest) {
  return handleCodePinCoverageReportPOST(req, true);
}
