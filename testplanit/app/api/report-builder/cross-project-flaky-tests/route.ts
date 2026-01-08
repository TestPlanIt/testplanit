import { NextRequest } from "next/server";
import { handleFlakyTestsPOST } from "~/utils/flakyTestsUtils";

export async function GET() {
  // Return empty dimensions/metrics since this is a specialized report
  return Response.json({
    dimensions: [],
    metrics: [],
  });
}

export async function POST(req: NextRequest) {
  return handleFlakyTestsPOST(req, true); // true = cross-project
}
