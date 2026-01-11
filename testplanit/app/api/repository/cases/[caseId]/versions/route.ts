import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { z } from "zod";

/**
 * Centralized endpoint for creating test case versions.
 * This ensures consistent version creation across all parts of the application:
 * - Manual case creation/editing
 * - Bulk edits
 * - Imports (CSV/XML/JSON)
 * - External integrations (Testmo, etc.)
 * - LLM-generated cases
 *
 * IMPORTANT: This endpoint creates a version snapshot of the test case's CURRENT state.
 * The caller is responsible for updating RepositoryCases.currentVersion BEFORE calling this endpoint.
 * The version number will match the test case's currentVersion field.
 *
 * Workflow:
 * 1. Update RepositoryCases (including incrementing currentVersion if editing)
 * 2. Call this endpoint to create a version snapshot matching that currentVersion
 */

const createVersionSchema = z.object({
  // Optional: explicit version number (for imports that want to preserve versions)
  // If not provided, will use the test case's currentVersion
  version: z.number().int().positive().optional(),

  // Optional: override creator metadata (for imports)
  creatorId: z.string().optional(),
  creatorName: z.string().optional(),
  createdAt: z.string().datetime().optional(),

  // Optional: data to override in the version
  // If not provided, will copy from current test case
  overrides: z
    .object({
      name: z.string().min(1).optional(),
      stateId: z.number().int().optional(),
      stateName: z.string().optional(),
      automated: z.boolean().optional(),
      estimate: z.number().int().nullable().optional(),
      forecastManual: z.number().int().nullable().optional(),
      forecastAutomated: z.number().nullable().optional(),
      steps: z.any().optional(), // JSON field
      tags: z.array(z.string()).optional(), // Array of tag names
      issues: z
        .array(
          z.object({
            id: z.number().int(),
            name: z.string(),
            externalId: z.string().optional(),
          })
        )
        .optional(),
      attachments: z.any().optional(), // JSON field
      links: z.any().optional(), // JSON field
      isArchived: z.boolean().optional(),
      order: z.number().int().optional(),
    })
    .optional(),
});

type CreateVersionRequest = z.infer<typeof createVersionSchema>;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam } = await params;
    const caseId = parseInt(caseIdParam);
    if (isNaN(caseId)) {
      return NextResponse.json(
        { error: "Invalid case ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = createVersionSchema.parse(body);

    // Fetch the current test case with all necessary relations
    const testCase = await prisma.repositoryCases.findUnique({
      where: { id: caseId },
      include: {
        project: true,
        folder: true,
        template: true,
        state: true,
        creator: true,
        tags: { select: { name: true } },
        issues: {
          select: { id: true, name: true, externalId: true },
        },
        steps: {
          orderBy: { order: "asc" },
          select: { step: true, expectedResult: true },
        },
      },
    });

    if (!testCase) {
      return NextResponse.json(
        { error: "Test case not found" },
        { status: 404 }
      );
    }

    // Calculate version number
    // Use the currentVersion from the test case (which should already be updated by the caller)
    // or allow explicit version override for imports
    const versionNumber =
      validatedData.version ?? testCase.currentVersion;

    // Determine creator (use override if provided, otherwise current session user)
    const creatorId = validatedData.creatorId ?? session.user.id;
    const creatorName =
      validatedData.creatorName ??
      session.user.name ??
      session.user.email ??
      "";
    const createdAt = validatedData.createdAt
      ? new Date(validatedData.createdAt)
      : testCase.createdAt;

    // Build version data, applying overrides
    const overrides = validatedData.overrides ?? {};

    // Convert steps to JSON format for version storage
    let stepsJson: any = null;
    if (overrides.steps !== undefined) {
      stepsJson = overrides.steps;
    } else if (testCase.steps && testCase.steps.length > 0) {
      stepsJson = testCase.steps.map((step: { step: any; expectedResult: any }) => ({
        step: step.step,
        expectedResult: step.expectedResult,
      }));
    }

    // Convert tags to array of tag names
    const tagsArray =
      overrides.tags ?? testCase.tags.map((tag: { name: string }) => tag.name);

    // Convert issues to array of objects
    const issuesArray = overrides.issues ?? testCase.issues;

    // Prepare version data
    const versionData = {
      repositoryCaseId: testCase.id,
      staticProjectId: testCase.projectId,
      staticProjectName: testCase.project.name,
      projectId: testCase.projectId,
      repositoryId: testCase.repositoryId,
      folderId: testCase.folderId,
      folderName: testCase.folder.name,
      templateId: testCase.templateId,
      templateName: testCase.template.templateName,
      name: overrides.name ?? testCase.name,
      stateId: overrides.stateId ?? testCase.stateId,
      stateName: overrides.stateName ?? testCase.state.name,
      estimate: overrides.estimate !== undefined ? overrides.estimate : testCase.estimate,
      forecastManual:
        overrides.forecastManual !== undefined
          ? overrides.forecastManual
          : testCase.forecastManual,
      forecastAutomated:
        overrides.forecastAutomated !== undefined
          ? overrides.forecastAutomated
          : testCase.forecastAutomated,
      order: overrides.order ?? testCase.order,
      createdAt,
      creatorId,
      creatorName,
      automated: overrides.automated ?? testCase.automated,
      isArchived: overrides.isArchived ?? testCase.isArchived,
      isDeleted: false, // Versions should never be marked as deleted
      version: versionNumber,
      steps: stepsJson,
      tags: tagsArray,
      issues: issuesArray,
      links: overrides.links ?? [],
      attachments: overrides.attachments ?? [],
    };

    // Create the version
    // Note: We expect the caller to have already updated currentVersion on the test case
    // before calling this endpoint. We simply snapshot the current state.
    const result = await prisma.repositoryCaseVersions.create({
      data: versionData,
    });

    return NextResponse.json({
      success: true,
      version: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating test case version:", error);
    return NextResponse.json(
      {
        error: "Failed to create test case version",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
