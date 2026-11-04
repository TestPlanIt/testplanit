import { NextRequest } from "next/server";
import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import {
  createLlmUsageDimensionRegistry,
  createLlmUsageMetricRegistry,
} from "~/utils/llmUsageReportUtils";
import { withReplicaRoute } from "~/lib/db/replicaRoute";

const config = {
  reportType: "cross-project-llm-usage",
  requiresProjectId: false,
  requiresAdmin: true,
  createDimensionRegistry: createLlmUsageDimensionRegistry,
  createMetricRegistry: createLlmUsageMetricRegistry,
};

async function reportGet(req: NextRequest) {
  return handleReportGET(req, config);
}

async function reportPost(req: NextRequest) {
  return handleReportPOST(req, config);
}

export const GET = withReplicaRoute(reportGet);
export const POST = withReplicaRoute(reportPost);
