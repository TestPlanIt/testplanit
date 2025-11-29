import { NextRequest } from "next/server";
import { handleReportGET } from "~/utils/reportApiUtils";
import { handleAutomationTrendsPOST } from "~/utils/automationTrendsUtils";
import {
  createAutomationTrendsDimensionRegistry,
  createAutomationTrendsMetricRegistry,
} from "~/utils/reportUtils";

const config = {
  reportType: "automation-trends",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: () => createAutomationTrendsDimensionRegistry(false),
  createMetricRegistry: () => createAutomationTrendsMetricRegistry(false),
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleAutomationTrendsPOST(req, true); // true = cross-project
}
