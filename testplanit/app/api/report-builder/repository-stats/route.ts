import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createRepositoryStatsDimensionRegistry,
  createRepositoryStatsMetricRegistry
} from "~/utils/reportUtils";

const config = {
  reportType: "repository-stats",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createRepositoryStatsDimensionRegistry,
  createMetricRegistry: createRepositoryStatsMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}