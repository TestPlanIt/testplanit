import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createUserEngagementDimensionRegistry,
  createUserEngagementMetricRegistry
} from "~/utils/reportUtils";

const config = {
  reportType: "cross-project-user-engagement",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: createUserEngagementDimensionRegistry,
  createMetricRegistry: createUserEngagementMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}