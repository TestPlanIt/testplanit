import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";
import { withRequestRouting } from "~/lib/db/requestRouting";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/upload-project-icon
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
async function handlePOST(req: NextRequest) {
  return handleUploadRequest(req, "project-icon");
}

export const POST = withRequestRouting(handlePOST);
