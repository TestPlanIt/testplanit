import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry
} from "~/utils/reportUtils";

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