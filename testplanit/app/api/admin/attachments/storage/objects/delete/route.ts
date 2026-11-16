import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { orphanDeleteSchema } from "~/lib/services/storageObjects";
import { deleteOrphanObjects } from "~/lib/services/storageScan";
import { db } from "~/server/db";
import { checkAdminAuth } from "../../../../trash/shared";

/**
 * Delete orphaned objects from storage. `dryRun` reports what would be
 * deleted and changes nothing.
 */
export const POST = withAuditContext(async (request: NextRequest) => {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  const parsed = orphanDeleteSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await deleteOrphanObjects(db, parsed.data.keys, parsed.data.dryRun)
    );
  } catch (error) {
    console.error(
      "[API /api/admin/attachments/storage/objects/delete] Failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to delete storage objects" },
      { status: 500 }
    );
  }
});
