import { NextRequest } from "next/server";
import { handleAutomationTrendsPOST } from "~/utils/automationTrendsUtils";
import { handleReportGET } from "~/utils/reportApiUtils";
import {
  createAutomationTrendsDimensionRegistry,
  createAutomationTrendsMetricRegistry,
} from "~/utils/reportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

const config = {
  reportType: "automation-trends",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: () => createAutomationTrendsDimensionRegistry(false),
  createMetricRegistry: () => createAutomationTrendsMetricRegistry(false),
};

async function reportGet(req: NextRequest) {
  return handleReportGET(req, config);
}

async function reportPost(req: NextRequest) {
  return handleAutomationTrendsPOST(req, true); // true = cross-project
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
