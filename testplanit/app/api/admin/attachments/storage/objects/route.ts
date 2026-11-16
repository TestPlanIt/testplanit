import { NextRequest, NextResponse } from "next/server";
import {
  listStorageObjects,
  storageObjectQuerySchema,
} from "~/lib/services/storageObjects";
import { checkAdminAuth } from "../../../trash/shared";

/** The objects the last storage scan found, paged, for Admin > Attachments. */
export async function GET(request: NextRequest) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  const parsed = storageObjectQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await listStorageObjects(parsed.data));
  } catch (error) {
    console.error(
      "[API /api/admin/attachments/storage/objects] Failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to list storage objects" },
      { status: 500 }
    );
  }
}
