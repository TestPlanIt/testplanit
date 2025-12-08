import { NextResponse, NextRequest } from "next/server";
import { db } from "~/server/db";
import { getServerAuthSession } from "~/server/auth";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { captureAuditEvent } from "~/lib/services/auditLog";

// S3 Client Initialization (ensure environment variables are set)
const s3Client = new S3Client({
  region: process.env.AWS_BUCKET_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

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
    // Depending on requirements, you might want to throw this error
    // or handle it (e.g., by logging and continuing)
    throw error; // Re-throwing for now, can be adjusted
  }
}

// Consistent map structure providing model delegate and modelName string
const itemTypeToModelMap: Record<string, { model: any; modelName: string }> = {
  User: { model: db.user, modelName: "User" },
  Groups: { model: db.groups, modelName: "Groups" },
  Roles: { model: db.roles, modelName: "Roles" },
  Projects: { model: db.projects, modelName: "Projects" },
  Milestones: { model: db.milestones, modelName: "Milestones" },
  MilestoneTypes: { model: db.milestoneTypes, modelName: "MilestoneTypes" },
  CaseFields: { model: db.caseFields, modelName: "CaseFields" },
  ResultFields: { model: db.resultFields, modelName: "ResultFields" },
  FieldOptions: { model: db.fieldOptions, modelName: "FieldOptions" },
  Templates: { model: db.templates, modelName: "Templates" },
  Status: { model: db.status, modelName: "Status" },
  Workflows: { model: db.workflows, modelName: "Workflows" },
  ConfigCategories: {
    model: db.configCategories,
    modelName: "ConfigCategories",
  },
  ConfigVariants: { model: db.configVariants, modelName: "ConfigVariants" },
  Configurations: { model: db.configurations, modelName: "Configurations" },
  Tags: { model: db.tags, modelName: "Tags" },
  Repositories: { model: db.repositories, modelName: "Repositories" },
  RepositoryFolders: {
    model: db.repositoryFolders,
    modelName: "RepositoryFolders",
  },
  RepositoryCaseLink: {
    model: db.repositoryCaseLink,
    modelName: "RepositoryCaseLink",
  },
  RepositoryCases: { model: db.repositoryCases, modelName: "RepositoryCases" },
  RepositoryCaseVersions: {
    model: db.repositoryCaseVersions,
    modelName: "RepositoryCaseVersions",
  },
  Attachments: { model: db.attachments, modelName: "Attachments" },
  Steps: { model: db.steps, modelName: "Steps" },
  Sessions: { model: db.sessions, modelName: "Sessions" },
  SessionResults: { model: db.sessionResults, modelName: "SessionResults" },
  SessionVersions: { model: db.sessionVersions, modelName: "SessionVersions" }, // Added SessionVersions
  TestRuns: { model: db.testRuns, modelName: "TestRuns" },
  TestRunCases: { model: db.testRunCases, modelName: "TestRunCases" }, // Added TestRunCases
  TestRunResults: { model: db.testRunResults, modelName: "TestRunResults" },
  TestRunStepResults: {
    model: db.testRunStepResults,
    modelName: "TestRunStepResults",
  },
  Issues: { model: db.issue, modelName: "Issues" },
  AppConfig: { model: db.appConfig, modelName: "AppConfig" },
  JUnitTestSuite: { model: db.jUnitTestSuite, modelName: "JUnitTestSuite" },
  JUnitTestResult: { model: db.jUnitTestResult, modelName: "JUnitTestResult" },
  JUnitProperty: { model: db.jUnitProperty, modelName: "JUnitProperty" },
  JUnitAttachment: { model: db.jUnitAttachment, modelName: "JUnitAttachment" },
  JUnitTestStep: { model: db.jUnitTestStep, modelName: "JUnitTestStep" },
  // Ensure all models that can be soft-deleted and purged are in this map with the correct structure.
};

// PATCH handler for restoring an item (setting isDeleted = false)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemType: string; itemId: string }> }
) {
  const session = await getServerAuthSession();
  if (!session || session.user?.access !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const params = await context.params;
  const { itemType, itemId } = params;
  const modelMapEntry = itemTypeToModelMap[itemType];

  if (!modelMapEntry) {
    return NextResponse.json({ error: "Invalid item type" }, { status: 404 });
  }

  if (!itemId) {
    return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
  }

  try {
    let idForQuery: string | number = itemId;
    const intIdModels = [
      "Roles",
      "Groups",
      "Projects",
      "Milestones",
      "MilestoneTypes",
      "Icon",
      "CaseFields",
      "ResultFields",
      "FieldOptions",
      "Templates",
      "Status",
      "Workflows",
      "ConfigCategories",
      "ConfigVariants",
      "Configurations",
      "Tags",
      "Repositories",
      "RepositoryFolders",
      "RepositoryCases",
      "RepositoryCaseVersions",
      "Attachments",
      "Steps",
      "Sessions",
      "SessionResults",
      "SessionVersions",
      "TestRuns",
      "TestRunCases",
      "TestRunResults",
      "TestRunStepResults",
      "Issues",
      "JUnitTestSuite",
      "JUnitTestResult",
      "JUnitProperty",
      "JUnitAttachment",
      "JUnitTestStep",
      "RepositoryCaseLink",
    ];

    if (intIdModels.includes(modelMapEntry.modelName)) {
      const parsedId = parseInt(itemId, 10);
      if (isNaN(parsedId)) {
        return NextResponse.json(
          {
            error: `Invalid Item ID format for ${modelMapEntry.modelName}. Expected integer.`,
          },
          { status: 400 }
        );
      }
      idForQuery = parsedId;
    }

    const restoredItem = await modelMapEntry.model.update({
      where: { id: idForQuery as any }, // Cast as any for now
      data: { isDeleted: false },
    });

    // Audit the restore operation
    captureAuditEvent({
      action: "UPDATE",
      entityType: modelMapEntry.modelName,
      entityId: String(idForQuery),
      entityName: (restoredItem as any).name || (restoredItem as any).title || (restoredItem as any).email,
      metadata: {
        operation: "restore_from_trash",
      },
    }).catch((error) =>
      console.error("[AuditLog] Failed to audit trash restore:", error)
    );

    return NextResponse.json(restoredItem);
  } catch (error: any) {
    console.error(`Failed to restore ${itemType} with ID ${itemId}:`, error);
    if (error.code === "P2025") {
      return NextResponse.json(
        {
          error: `${modelMapEntry.modelName} with ID ${itemId} not found or already not deleted.`,
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: `Failed to restore ${modelMapEntry.modelName}: ${error.message}`,
      },
      { status: 500 }
    );
  }
}

// DELETE handler for purging an item (hard delete)
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ itemType: string; itemId: string }> }
) {
  const session = await getServerAuthSession();
  if (!session || session.user?.access !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const params = await context.params;
  const { itemType, itemId } = params;
  const modelMapEntry = itemTypeToModelMap[itemType]; // Use modelMapEntry

  if (!modelMapEntry) {
    // Check modelMapEntry
    return NextResponse.json({ error: "Invalid item type" }, { status: 404 });
  }

  if (!itemId) {
    return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
  }

  let idForQuery: string | number = itemId;

  const intIdModels = [
    "Roles",
    "Groups",
    "Projects",
    "Milestones",
    "MilestoneTypes",
    "Icon",
    "CaseFields",
    "ResultFields",
    "FieldOptions",
    "Templates",
    "Status",
    "Workflows",
    "ConfigCategories",
    "ConfigVariants",
    "Configurations",
    "Tags",
    "Repositories",
    "RepositoryFolders",
    "RepositoryCases",
    "RepositoryCaseVersions",
    "Attachments",
    "Steps",
    "Sessions",
    "SessionResults",
    "SessionVersions",
    "TestRuns",
    "TestRunCases",
    "TestRunResults",
    "TestRunStepResults",
    "Issues",
    "JUnitTestSuite",
    "JUnitTestResult",
    "JUnitProperty",
    "JUnitAttachment",
    "JUnitTestStep",
    "RepositoryCaseLink",
  ];

  if (intIdModels.includes(modelMapEntry.modelName)) {
    // Use modelMapEntry.modelName
    idForQuery = parseInt(itemId, 10);
    if (isNaN(idForQuery)) {
      return NextResponse.json(
        {
          error: `Invalid ID format for ${modelMapEntry.modelName}. Expected integer.`,
        },
        { status: 400 }
      );
    }
  }

  try {
    const itemToPurge = await modelMapEntry.model.findUnique({
      // Use modelMapEntry.model
      where: { id: idForQuery as any },
    });

    if (!itemToPurge) {
      return NextResponse.json(
        { error: `${modelMapEntry.modelName} with ID ${itemId} not found.` }, // Use modelMapEntry.modelName
        { status: 404 }
      );
    }

    if (
      typeof (itemToPurge as any).isDeleted === "boolean" &&
      !(itemToPurge as any).isDeleted
    ) {
      return NextResponse.json(
        {
          error: `${modelMapEntry.modelName} with ID ${itemId} is not marked as deleted. Purge operation aborted.`,
        },
        { status: 400 }
      );
    }

    await modelMapEntry.model.delete({ where: { id: idForQuery as any } }); // Use modelMapEntry.model

    // Audit the permanent delete (purge) operation
    captureAuditEvent({
      action: "DELETE",
      entityType: modelMapEntry.modelName,
      entityId: String(idForQuery),
      entityName: (itemToPurge as any).name || (itemToPurge as any).title || (itemToPurge as any).email,
      metadata: {
        operation: "permanent_delete",
        purgedFromTrash: true,
      },
    }).catch((error) =>
      console.error("[AuditLog] Failed to audit trash purge:", error)
    );

    // If itemType is Attachments, delete from S3
    if (modelMapEntry.modelName === "Attachments" && (itemToPurge as any).url) {
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
          // Decide on behavior: fail the request or just log? For now, log and continue.
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
        // Optional: Decide if this failure should make the whole purge fail.
        // For now, we'll return a success for DB purge but log the S3 error.
        // You might want to return a different status or error message.
      }
    }

    return NextResponse.json(
      {
        message: `${modelMapEntry.modelName} with ID ${itemId} purged successfully.`,
      }, // Use modelMapEntry.modelName
      { status: 200 }
    );
  } catch (error: any) {
    console.error(
      `Failed to purge ${modelMapEntry.modelName} with ID ${itemId}:`,
      error
    ); // Use modelMapEntry.modelName
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: `${modelMapEntry.modelName} with ID ${itemId} not found.` }, // Use modelMapEntry.modelName
        { status: 404 }
      );
    }
    if (error.code === "P2003" || error.code === "P2014") {
      return NextResponse.json(
        {
          error: `Failed to purge ${modelMapEntry.modelName} due to existing related data. Please ensure related items are also removed or handle cascading deletes appropriately.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `Failed to purge ${modelMapEntry.modelName}: ${error.message}` }, // Use modelMapEntry.modelName
      { status: 500 }
    );
  }
}
