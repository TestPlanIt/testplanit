import { NextRequest } from "next/server";
import { handleAutomationTrendsPOST } from "~/utils/automationTrendsUtils";
import { handleReportGET } from "~/utils/reportApiUtils";
import {
  createAutomationTrendsDimensionRegistry,
  createAutomationTrendsMetricRegistry
} from "~/utils/reportUtils";

const config = {
  reportType: "automation-trends",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createAutomationTrendsDimensionRegistry,
  createMetricRegistry: createAutomationTrendsMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleAutomationTrendsPOST(req, false); // false = project-specific
}
