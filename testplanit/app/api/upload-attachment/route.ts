import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";
import { withRequestRouting } from "~/lib/db/requestRouting";

/**
 * POST /api/upload-attachment
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
async function handlePOST(req: NextRequest) {
  return handleUploadRequest(req, "attachment");
}

export const POST = withRequestRouting(handlePOST);
