import { NextRequest } from "next/server";
import { handleUploadRequest } from "~/lib/storageRoutes";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/upload-project-icon
 *
 * Server-side upload proxy for instances whose storage is not publicly
 * reachable. Form fields: `file` (required), `prependString` (optional).
 */
export async function POST(req: NextRequest) {
  return handleUploadRequest(req, "project-icon");
}
