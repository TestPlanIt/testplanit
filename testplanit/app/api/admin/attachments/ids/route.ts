import { NextRequest, NextResponse } from "next/server";
import {
  adminAttachmentQuerySchema,
  listAdminAttachmentIds,
} from "~/lib/services/adminAttachments";
import { checkAdminAuth } from "../../trash/shared";
import { withRequestRouting } from "~/lib/db/requestRouting";

/** The ids of every attachment the list's filters match, for "select all". */
async function handleGET(request: NextRequest) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  const parsed = adminAttachmentQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({
      ids: await listAdminAttachmentIds(parsed.data),
    });
  } catch (error) {
    console.error("[API /api/admin/attachments/ids] Failed:", error);
    return NextResponse.json(
      { error: "Failed to list attachment ids" },
      { status: 500 }
    );
  }
}

export const GET = withRequestRouting(handleGET);
