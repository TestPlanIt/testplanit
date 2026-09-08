import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createLlmUsageDimensionRegistry,
  createLlmUsageMetricRegistry,
} from "~/utils/llmUsageReportUtils";

const config = {
  reportType: "cross-project-llm-usage",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: createLlmUsageDimensionRegistry,
  createMetricRegistry: createLlmUsageMetricRegistry,
};

export async function GET(req: NextRequest) {
  return handleReportGET(req, config);
}

export async function POST(req: NextRequest) {
  return handleReportPOST(req, config);
}
