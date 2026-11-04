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
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createAutomationTrendsDimensionRegistry,
  createMetricRegistry: createAutomationTrendsMetricRegistry,
};

async function reportGet(req: NextRequest) {
  return handleReportGET(req, config);
}

async function reportPost(req: NextRequest) {
  return handleAutomationTrendsPOST(req, false); // false = project-specific
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
