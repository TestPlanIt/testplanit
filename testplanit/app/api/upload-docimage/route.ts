import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";
import { withRequestRouting } from "~/lib/db/requestRouting";

/**
 * POST /api/upload-docimage
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
async function handlePOST(req: NextRequest) {
  return handleUploadRequest(req, "docimage");
}

export const POST = withRequestRouting(handlePOST);
