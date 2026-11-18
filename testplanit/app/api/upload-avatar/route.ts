import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";
import { withRequestRouting } from "~/lib/db/requestRouting";

/**
 * POST /api/upload-avatar
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
async function handlePOST(req: NextRequest) {
  return handleUploadRequest(req, "avatar");
}

export const POST = withRequestRouting(handlePOST);
