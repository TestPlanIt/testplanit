import { NextRequest, NextResponse } from "next/server";
import {
  checkAdminAuth,
  itemTypeToModelMap,
  softDeletedWhere,
} from "../shared";
import { withRequestRouting } from "~/lib/db/requestRouting";

// Returns the number of soft-deleted rows for every trash item type in a
// single batched request, so the Trash UI can show at-a-glance counts without
// opening each type. Restore/purge behavior is unchanged.
async function handleGET(request: NextRequest) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const entries = Object.entries(itemTypeToModelMap);
    const results = await Promise.all(
      entries.map(async ([itemType, model]) => {
        try {
          const count = await model.count({
            where: softDeletedWhere(itemType),
          });
          return [itemType, count] as const;
        } catch (error) {
          console.error(
            `[API /api/admin/trash/counts] Failed to count ${itemType}:`,
            error
          );
          return [itemType, 0] as const;
        }
      })
    );

    const counts: Record<string, number> = Object.fromEntries(results);

    return NextResponse.json({ counts });
  } catch (error) {
    console.error(
      "[API /api/admin/trash/counts] Failed to fetch counts:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch trash counts" },
      { status: 500 }
    );
  }
}

export const GET = withRequestRouting(handleGET);
