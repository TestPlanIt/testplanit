import { NextRequest } from "next/server";
import {
  handleFlakyTestsOptionsGET,
  handleFlakyTestsPOST,
} from "~/utils/flakyTestsUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

async function reportGet(req: NextRequest) {
  return handleFlakyTestsOptionsGET(req, false);
}

async function reportPost(req: NextRequest) {
  return handleFlakyTestsPOST(req, false);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
