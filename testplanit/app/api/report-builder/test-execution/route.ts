import { NextRequest } from "next/server";
import {
  createTestExecutionDimensionRegistry,
  createTestExecutionMetricRegistry,
} from "~/utils/reportUtils";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";

const config = {
  reportType: "test-execution",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: createTestExecutionDimensionRegistry,
  createMetricRegistry: createTestExecutionMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}