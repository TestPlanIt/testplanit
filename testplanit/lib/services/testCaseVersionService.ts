import type { User } from "next-auth";

/**
 * Service for creating test case versions.
 * This provides a consistent interface for version creation across the application.
 */

export interface CreateVersionOptions {
  /**
   * The test case ID to create a version for
   */
  caseId: number;

  /**
   * Optional: explicit version number (for imports that want to preserve versions)
   * If not provided, will use the test case's currentVersion
   */
  version?: number;

  /**
   * Optional: override creator metadata (for imports)
   */
  creatorId?: string;
  creatorName?: string;
  createdAt?: Date;

  /**
   * Optional: data to override in the version
   * If not provided, will copy from current test case
   */
  overrides?: {
    name?: string;
    stateId?: number;
    stateName?: string;
    automated?: boolean;
    estimate?: number | null;
    forecastManual?: number | null;
    forecastAutomated?: number | null;
    steps?: any; // JSON field
    tags?: string[]; // Array of tag names
    issues?: Array<{
      id: number;
      name: string;
      externalId?: string;
    }>;
    attachments?: any; // JSON field
    links?: any; // JSON field
    isArchived?: boolean;
    order?: number;
  };
}

export interface CreateVersionResult {
  success: boolean;
  version?: any;
  error?: string;
}

/**
 * Creates a test case version by calling the centralized API endpoint.
 * This function can be used from both server-side API routes and background workers.
 *
 * @param user - The authenticated user making the request
 * @param options - Version creation options
 * @returns Promise with the created version or error
 */
export async function createTestCaseVersion(
  user: User,
  options: CreateVersionOptions
): Promise<CreateVersionResult> {
  try {
    // For server-side calls, we need to construct the full URL
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const url = `${baseUrl}/api/repository/cases/${options.caseId}/versions`;

    // Prepare the request body
    const body = {
      version: options.version,
      creatorId: options.creatorId,
      creatorName: options.creatorName,
      createdAt: options.createdAt?.toISOString(),
      overrides: options.overrides,
    };

    // Make the request with the user's session
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass user context for authentication
        // Note: This assumes the API endpoint can validate the user from headers
        // You may need to adjust this based on your auth setup
        Cookie: `next-auth.session-token=${user.id}`, // Adjust based on your auth implementation
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.error || "Failed to create version",
      };
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error creating test case version:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Direct database version creation function for use within transactions.
 * This bypasses the API endpoint and creates versions directly in the database.
 * Use this when you're already in a transaction context.
 *
 * IMPORTANT: The caller is responsible for updating RepositoryCases.currentVersion
 * BEFORE calling this function. This function creates a snapshot matching currentVersion.
 *
 * @param tx - Prisma transaction client
 * @param caseId - Test case ID
 * @param options - Version creation options
 */
export async function createTestCaseVersionInTransaction(
  tx: any, // Prisma transaction client type
  caseId: number,
  options: Omit<CreateVersionOptions, "caseId">
) {
  // Fetch the current test case with all necessary relations
  const testCase = await tx.repositoryCases.findUnique({
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
    throw new Error(`Test case ${caseId} not found`);
  }

  // Calculate version number
  // Use the currentVersion from the test case (which should already be updated by the caller)
  // or allow explicit version override for imports
  const versionNumber = options.version ?? testCase.currentVersion;

  // Determine creator
  const creatorId = options.creatorId ?? testCase.creatorId;
  const creatorName = options.creatorName ?? testCase.creator.name ?? "";
  // Use provided createdAt (for imports), otherwise use current time (for new versions)
  const createdAt = options.createdAt ?? new Date();

  // Build version data, applying overrides
  const overrides = options.overrides ?? {};

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
  const tagsArray = overrides.tags ?? testCase.tags.map((tag: { name: string }) => tag.name);

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
    estimate:
      overrides.estimate !== undefined ? overrides.estimate : testCase.estimate,
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

  // Create the version with retry logic to handle race conditions
  // Note: We expect the caller to have already updated currentVersion on the test case
  // before calling this function. We simply snapshot the current state.
  let newVersion;
  let retryCount = 0;
  const maxRetries = 3;
  const baseDelay = 100; // milliseconds

  while (retryCount <= maxRetries) {
    try {
      newVersion = await tx.repositoryCaseVersions.create({
        data: versionData,
      });
      break; // Success, exit retry loop
    } catch (error: any) {
      // Check if it's a unique constraint violation (P2002)
      if (error.code === "P2002" && retryCount < maxRetries) {
        retryCount++;
        const delay = baseDelay * Math.pow(2, retryCount - 1); // Exponential backoff
        console.log(
          `Unique constraint violation on version creation (attempt ${retryCount}/${maxRetries}). Retrying after ${delay}ms...`
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Refetch the test case to get the latest currentVersion
        const refetchedCase = await tx.repositoryCases.findUnique({
          where: { id: caseId },
          select: { currentVersion: true },
        });

        if (refetchedCase) {
          // Update the version number with the refetched value
          versionData.version = options.version ?? refetchedCase.currentVersion;
        }
      } else {
        // Not a retryable error or max retries reached
        throw error;
      }
    }
  }

  if (!newVersion) {
    throw new Error(`Failed to create version for case ${caseId} after retries`);
  }

  return newVersion;
}
