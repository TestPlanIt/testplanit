import { NextRequest } from "next/server";
import { handleExecutionLogPOST } from "~/utils/executionLogUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet() {
  return Response.json({ dimensions: [], metrics: [] });
}

async function reportPost(req: NextRequest) {
  return handleExecutionLogPOST(req, true);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
