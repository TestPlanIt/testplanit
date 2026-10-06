import { NextRequest } from "next/server";
import { handleResultsTrendPOST } from "~/utils/resultsTrendUtils";

export async function GET() {
  // A pre-built report: no dimension or metric selection.
  return Response.json({ dimensions: [], metrics: [] });
}

export async function POST(req: NextRequest) {
  return handleResultsTrendPOST(req, false);
}
