import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "~/lib/s3Client";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { syncRunCaseStatusAfterResultRemoval } from "~/lib/services/runCaseStatusSync";
import { isForeignKeyError, isNotFoundError } from "~/lib/utils/errors";
import { db } from "~/server/db";
import { checkAdminAuth, getTrashModel, TrashModel } from "../../shared";

// This used to build its own client with no `endpoint`, so purge deletes always
// went to real AWS S3 and silently missed the object on any S3-compatible
// backend (MinIO). It also read only AWS_BUCKET_REGION, which .env.example does
// not define. Going through the shared factory fixes both.
const s3Client = getS3Client();

// Helper function to delete an object from S3
async function deleteS3Object(bucketName: string, key: string) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  try {
    await s3Client.send(command);
  } catch (error) {
    console.error(
      `[S3 Delete] Error deleting object ${bucketName}/${key}:`,
      error
    );
    throw error;
  }
}

// Coerces the URL segment to the model's primary-key type.
function parseItemId(
  entry: TrashModel,
  itemId: string
): { id: string | number } | { error: NextResponse } {
  if (entry.idType === "Int") {
    const parsedId = parseInt(itemId, 10);
    if (isNaN(parsedId)) {
      return {
        error: NextResponse.json(
          {
            error: `Invalid Item ID format for ${entry.modelName}. Expected integer.`,
          },
          { status: 400 }
        ),
      };
    }
    return { id: parsedId };
  }
  return { id: itemId };
}

function displayName(item: any): string | undefined {
  return item?.name || item?.title || item?.label || item?.email;
}

// PATCH handler for restoring an item (setting isDeleted = false)
export const PATCH = withAuditContext(
  async (
    request: NextRequest,
    context: { params: Promise<{ itemType: string; itemId: string }> }
  ) => {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    const params = await context.params;
    const { itemType, itemId } = params;
    const entry = getTrashModel(itemType);

    if (!entry) {
      return NextResponse.json({ error: "Invalid item type" }, { status: 404 });
    }

    if (!itemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    const parsed = parseItemId(entry, itemId);
    if ("error" in parsed) return parsed.error;
    const idForQuery = parsed.id;

    try {
      const restoredItem = await entry.model.update({
        where: { id: idForQuery as any },
        data: { isDeleted: false },
      });

      // Restoring a result can make it the newest one for its run-case again,
      // so re-derive the case's denormalized status. Without this the run keeps
      // showing the outcome it fell back to when the result was deleted. Same
      // helper the delete path uses, so both directions agree.
      //
      // The purge (DELETE) handler needs no equivalent: it only ever removes
      // rows that are already soft-deleted, which the status was already
      // re-derived without.
      if (entry.modelName === "TestRunResults") {
        const restored = restoredItem as {
          testRunCaseId?: number;
          iterationId?: number | null;
        };
        if (restored.testRunCaseId != null) {
          await syncRunCaseStatusAfterResultRemoval(db as any, {
            testRunCaseId: restored.testRunCaseId,
            iterationId: restored.iterationId ?? null,
          });
        }
      }

      // Audit the restore operation
      await captureAuditEvent({
        action: "UPDATE",
        entityType: entry.modelName,
        entityId: String(idForQuery),
        entityName: displayName(restoredItem),
        metadata: {
          operation: "restore_from_trash",
        },
      });

      return NextResponse.json(restoredItem);
    } catch (error: any) {
      console.error(`Failed to restore ${itemType} with ID ${itemId}:`, error);
      if (isNotFoundError(error)) {
        return NextResponse.json(
          {
            error: `${entry.modelName} with ID ${itemId} not found or already not deleted.`,
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          error: `Failed to restore ${entry.modelName}: ${error.message}`,
        },
        { status: 500 }
      );
    }
  }
);

// DELETE handler for purging an item (hard delete)
export const DELETE = withAuditContext(
  async (
    request: NextRequest,
    context: { params: Promise<{ itemType: string; itemId: string }> }
  ) => {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    const params = await context.params;
    const { itemType, itemId } = params;
    const entry = getTrashModel(itemType);

    if (!entry) {
      return NextResponse.json({ error: "Invalid item type" }, { status: 404 });
    }

    if (!itemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    const parsed = parseItemId(entry, itemId);
    if ("error" in parsed) return parsed.error;
    const idForQuery = parsed.id;

    try {
      const itemToPurge = await entry.model.findUnique({
        where: { id: idForQuery as any },
      });

      if (!itemToPurge) {
        return NextResponse.json(
          { error: `${entry.modelName} with ID ${itemId} not found.` },
          { status: 404 }
        );
      }

      if (!(itemToPurge as any).isDeleted) {
        return NextResponse.json(
          {
            error: `${entry.modelName} with ID ${itemId} is not marked as deleted. Purge operation aborted.`,
          },
          { status: 400 }
        );
      }

      await entry.model.delete({ where: { id: idForQuery as any } });

      // Audit the permanent delete (purge) operation
      await captureAuditEvent({
        action: "DELETE",
        entityType: entry.modelName,
        entityId: String(idForQuery),
        entityName: displayName(itemToPurge),
        metadata: {
          operation: "permanent_delete",
          purgedFromTrash: true,
        },
      });

      // If itemType is Attachments, delete from S3
      if (entry.modelName === "Attachments" && (itemToPurge as any).url) {
        const attachmentUrl = (itemToPurge as any).url;
        try {
          const urlObject = new URL(attachmentUrl);
          // Assuming the S3 key is the pathname part of the URL, removing leading '/'
          const s3Key = urlObject.pathname.startsWith("/")
            ? urlObject.pathname.substring(1)
            : urlObject.pathname;
          const bucketName = process.env.AWS_BUCKET_NAME!;

          if (!bucketName) {
            console.error(
              "[S3 Delete] AWS_BUCKET_NAME environment variable is not set. Cannot delete from S3."
            );
          } else if (s3Key) {
            await deleteS3Object(bucketName, s3Key);
          } else {
            console.warn(
              `[S3 Delete] Could not determine S3 key from URL: ${attachmentUrl}`
            );
          }
        } catch (s3Error) {
          console.error(
            `[PURGE /api/admin/trash/${itemType}/${itemId}] Failed to delete attachment from S3. URL: ${attachmentUrl}. Error:`,
            s3Error
          );
          // The DB purge already succeeded; report success and log the S3 miss.
        }
      }

      return NextResponse.json(
        {
          message: `${entry.modelName} with ID ${itemId} purged successfully.`,
        },
        { status: 200 }
      );
    } catch (error: any) {
      console.error(
        `Failed to purge ${entry.modelName} with ID ${itemId}:`,
        error
      );
      if (isNotFoundError(error)) {
        return NextResponse.json(
          { error: `${entry.modelName} with ID ${itemId} not found.` },
          { status: 404 }
        );
      }
      if (isForeignKeyError(error)) {
        return NextResponse.json(
          {
            error: `Failed to purge ${entry.modelName} due to existing related data. Please ensure related items are also removed or handle cascading deletes appropriately.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: `Failed to purge ${entry.modelName}: ${error.message}`,
        },
        { status: 500 }
      );
    }
  }
);
