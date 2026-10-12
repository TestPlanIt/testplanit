import { NextRequest } from "next/server";
import { handlePresignRequest } from "~/lib/storageRoutes";

export async function GET(req: NextRequest) {
  return handlePresignRequest(req, "project-icon");
}
