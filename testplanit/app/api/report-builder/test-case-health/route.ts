import { NextRequest } from "next/server";
import { handleTestCaseHealthPOST } from "~/utils/testCaseHealthUtils";

export async function GET() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

export async function POST(req: NextRequest) {
  return handleTestCaseHealthPOST(req, false); // false = project-specific
}
