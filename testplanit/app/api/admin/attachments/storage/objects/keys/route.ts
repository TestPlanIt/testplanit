import { NextRequest, NextResponse } from "next/server";
import {
  listStorageObjectKeys,
  storageObjectQuerySchema,
} from "~/lib/services/storageObjects";
import { checkAdminAuth } from "../../../../trash/shared";

/** The keys of every object the list's filters match, for "select all". */
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
    return NextResponse.json({
      keys: await listStorageObjectKeys(parsed.data),
    });
  } catch (error) {
    console.error(
      "[API /api/admin/attachments/storage/objects/keys] Failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to list storage object keys" },
      { status: 500 }
    );
  }
}
