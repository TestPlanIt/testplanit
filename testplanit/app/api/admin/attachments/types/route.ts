import { NextRequest, NextResponse } from "next/server";
import { listAttachmentMimeTypes } from "~/lib/services/adminAttachments";
import { checkAdminAuth } from "../../trash/shared";

/** The file types in use, for the type filter on Admin > Attachments. */
export async function GET(request: NextRequest) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    return NextResponse.json(await listAttachmentMimeTypes());
  } catch (error) {
    console.error("[API /api/admin/attachments/types] Failed:", error);
    return NextResponse.json(
      { error: "Failed to list attachment types" },
      { status: 500 }
    );
  }
}
