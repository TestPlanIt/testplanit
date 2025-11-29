import { NextRequest } from "next/server";
import {
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry,
} from "~/utils/reportUtils";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";

const config = {
  reportType: "issue-tracking",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createIssueTrackingDimensionRegistry,
  createMetricRegistry: createIssueTrackingMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}