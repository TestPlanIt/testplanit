import { NextRequest } from "next/server";
import { handleExecutionLogPOST } from "~/utils/executionLogUtils";

export async function GET() {
  return Response.json({ dimensions: [], metrics: [] });
}

export async function POST(req: NextRequest) {
  return handleExecutionLogPOST(req, true);
}
