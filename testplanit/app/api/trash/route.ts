import { NextRequest, NextResponse } from "next/server";
import { listUserTrash } from "~/lib/services/userTrash";
import { checkTrashAuth } from "./shared";

/**
 * The caller's own Trash: items they deleted, still inside the self-service
 * restore window, of a type they may restore, in a project they can still
 * edit. An ADMIN may pass `?userId=` to view another user's Trash (the profile
 * page shows the section to admins too).
 */
export async function GET(request: NextRequest) {
  const auth = await checkTrashAuth(request);
  if (auth.error) return auth.error;
  const actor = auth.actor!;

  const requested = request.nextUrl.searchParams.get("userId");
  if (requested && requested !== actor.id && !actor.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = requested ?? actor.id;

  try {
    const result = await listUserTrash(userId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API /api/trash] Failed to list trash:", error);
    return NextResponse.json(
      { error: "Failed to load trash" },
      { status: 500 }
    );
  }
}
