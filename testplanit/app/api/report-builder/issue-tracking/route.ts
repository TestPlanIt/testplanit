import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry,
} from "~/utils/reportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

const config = {
  reportType: "issue-tracking",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createIssueTrackingDimensionRegistry,
  createMetricRegistry: createIssueTrackingMetricRegistry,
};

async function reportGet(req: NextRequest) {
  return handleReportGET(req, config);
}

async function reportPost(req: NextRequest) {
  return handleReportPOST(req, config);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
