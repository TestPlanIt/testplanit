import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";

/**
 * POST /api/upload-attachment
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
export async function POST(req: NextRequest) {
  return handleUploadRequest(req, "attachment");
}
