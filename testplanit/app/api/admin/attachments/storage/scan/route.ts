import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  getStorageScanState,
  startStorageScan,
} from "~/lib/services/storageObjects";
import { checkAdminAuth } from "../../../trash/shared";
import { withRequestRouting } from "~/lib/db/requestRouting";

/** The last storage scan and what it found, for Admin > Attachments. */
async function handleGET(request: NextRequest) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    return NextResponse.json(await getStorageScanState());
  } catch (error) {
    console.error("[API /api/admin/attachments/storage/scan] Failed:", error);
    return NextResponse.json(
      { error: "Failed to read the storage scan" },
      { status: 500 }
    );
  }
}

export const GET = withRequestRouting(handleGET);

/** Start a storage scan. */
const handlePOST = withAuditContext(async (request: NextRequest) => {
  const auth = await checkAdminAuth(request);
  if (auth.error || !auth.userId) {
    return (
      auth.error ??
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  try {
    const outcome = await startStorageScan(auth.userId);
    if (outcome.started) return NextResponse.json(outcome);
    return NextResponse.json(
      {
        error:
          outcome.reason === "alreadyRunning"
            ? "A storage scan is already running"
            : "Background job queue is not available",
        reason: outcome.reason,
      },
      { status: outcome.reason === "alreadyRunning" ? 409 : 503 }
    );
  } catch (error) {
    console.error("[API /api/admin/attachments/storage/scan] Failed:", error);
    return NextResponse.json(
      { error: "Failed to start the storage scan" },
      { status: 500 }
    );
  }
});

export const POST = withRequestRouting(handlePOST);
