import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry
} from "~/utils/reportUtils";

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