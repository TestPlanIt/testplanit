import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  restoreUserTrashItem,
  UserTrashRestoreError,
  type UserTrashRestoreFailure,
} from "~/lib/services/userTrash";
import { checkTrashAuth } from "../../shared";

const failureStatus: Record<UserTrashRestoreFailure, number> = {
  unknown_type: 404,
  not_found: 404,
  disabled: 403,
  not_owner: 403,
  expired: 403,
  forbidden: 403,
  parent_deleted: 409,
  name_conflict: 409,
};

const failureMessage: Record<UserTrashRestoreFailure, string> = {
  unknown_type: "Invalid item type",
  not_found: "Item not found or not deleted",
  disabled: "Self-service restore is turned off",
  not_owner: "You can only restore items you deleted",
  expired: "The restore window for this item has passed",
  forbidden: "You no longer have permission to restore this item",
  parent_deleted:
    "The item's folder or parent is still deleted; restore that first",
  name_conflict: "An item with the same name already exists",
};

/**
 * Restores one of the caller's deleted items (plus its soft-deleted owned
 * children). Every ownership / window / permission check runs server-side;
 * ADMINs bypass ownership and the window, matching Admin > Trash.
 */
export const PATCH = withAuditContext(
  async (
    request: NextRequest,
    context: { params: Promise<{ itemType: string; itemId: string }> }
  ) => {
    const auth = await checkTrashAuth(request);
    if (auth.error) return auth.error;
    const actor = auth.actor!;

    const { itemType, itemId } = await context.params;
    try {
      const result = await restoreUserTrashItem({ actor, itemType, itemId });
      return NextResponse.json({
        id: String(result.item.id),
        itemType,
        projectId: result.projectId,
        restoredChildren: result.restored,
      });
    } catch (error) {
      if (error instanceof UserTrashRestoreError) {
        return NextResponse.json(
          { error: failureMessage[error.code], code: error.code },
          { status: failureStatus[error.code] }
        );
      }
      console.error(
        `[API /api/trash/${itemType}/${itemId}] Restore failed:`,
        error
      );
      return NextResponse.json(
        { error: "Failed to restore item" },
        { status: 500 }
      );
    }
  }
);
