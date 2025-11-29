import { NextRequest } from "next/server";
import {
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry,
} from "~/utils/reportUtils";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";

const config = {
  reportType: "cross-project-issue-tracking",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: createIssueTrackingDimensionRegistry,
  createMetricRegistry: createIssueTrackingMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}