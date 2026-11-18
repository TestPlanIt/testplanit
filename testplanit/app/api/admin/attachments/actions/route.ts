import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  applyAttachmentAction,
  attachmentActionSchema,
} from "~/lib/services/adminAttachmentActions";
import { checkAdminAuth } from "../../trash/shared";
import { withRequestRouting } from "~/lib/db/requestRouting";

/**
 * Detach, delete, restore or permanently delete attachments from
 * Admin > Attachments. `dryRun` reports what would happen and changes nothing.
 */
const handlePOST = withAuditContext(async (request: NextRequest) => {
  const auth = await checkAdminAuth(request);
  if (auth.error || !auth.userId) {
    return (
      auth.error ??
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const parsed = attachmentActionSchema.safeParse(
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
      await applyAttachmentAction(parsed.data, auth.userId)
    );
  } catch (error) {
    console.error("[API /api/admin/attachments/actions] Failed:", error);
    return NextResponse.json(
      { error: "Failed to apply the action" },
      { status: 500 }
    );
  }
});

export const POST = withRequestRouting(handlePOST);
