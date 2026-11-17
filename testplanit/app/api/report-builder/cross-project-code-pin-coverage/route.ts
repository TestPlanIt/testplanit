import { NextRequest } from "next/server";
import { handleCodePinCoverageReportPOST } from "~/utils/codePinCoverageReportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet() {
  // A pre-built report: no dimension or metric selection.
  return Response.json({ dimensions: [], metrics: [] });
}

async function reportPost(req: NextRequest) {
  return handleCodePinCoverageReportPOST(req, true);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
