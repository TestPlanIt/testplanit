import { NextRequest } from "next/server";
import { handlePresignRequest } from "~/lib/storageRoutes";
import { withRequestRouting } from "~/lib/db/requestRouting";

async function handleGET(req: NextRequest) {
  return handlePresignRequest(req, "avatar");
}

export const GET = withRequestRouting(handleGET);
