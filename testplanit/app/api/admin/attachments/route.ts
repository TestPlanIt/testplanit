import { NextRequest, NextResponse } from "next/server";
import {
  adminAttachmentQuerySchema,
  listAdminAttachments,
} from "~/lib/services/adminAttachments";
import { checkAdminAuth } from "../trash/shared";

/** Every attachment on the instance, paged, for Admin > Attachments. */
export async function GET(request: NextRequest) {
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
    return NextResponse.json(await listAdminAttachments(parsed.data));
  } catch (error) {
    console.error("[API /api/admin/attachments] Failed to list:", error);
    return NextResponse.json(
      { error: "Failed to list attachments" },
      { status: 500 }
    );
  }
}
