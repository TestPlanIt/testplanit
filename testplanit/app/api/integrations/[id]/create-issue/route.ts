import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { prisma } from "@/lib/prisma";
import { z } from "zod/v4";

const createIssueSchema = z.object({
  title: z.string(),
  description: z
    .union([
      z.string(),
      z.object({
        type: z.literal("doc"),
        content: z.array(z.any()),
      }),
    ])
    .optional(),
  projectId: z.string(), // External project ID (e.g., "owner/repo" for GitHub, project key for Jira)
  testplanitProjectId: z.number().optional(), // Internal TestPlanIt project ID for database storage
  issueType: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  testCaseId: z.string().optional(),
  testRunId: z.string().optional(),
  sessionId: z.string().optional(),
  testRunResultId: z.string().optional(),
  testRunStepResultId: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const integrationId = id;

    // console.log(`Creating issue for integration ${integrationId}`);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createIssueSchema.parse(body);

    // First try to get user's integration auth
    const userIntegrationAuth = await prisma.userIntegrationAuth.findFirst({
      where: {
        userId: session.user.id,
        integrationId: parseInt(integrationId),
        isActive: true,
        integration: {
          status: "ACTIVE",
        },
      },
      include: {
        integration: true,
      },
    });

    // If no user auth, check if the integration supports API key auth
    let integration;
    if (!userIntegrationAuth) {
      // console.log(
      //   `No user auth found for user ${session.user.id} and integration ${integrationId}`
      // );

      integration = await prisma.integration.findUnique({
        where: {
          id: parseInt(integrationId),
          status: "ACTIVE",
        },
      });

      // console.log(
      //   `Found integration:`,
      //   integration
      //     ? {
      //         id: integration.id,
      //         authType: integration.authType,
      //         status: integration.status,
      //       }
      //     : null
      // );

      if (!integration) {
        return NextResponse.json(
          { error: "Integration not found or inactive", integrationId },
          { status: 404 }
        );
      }

      // For OAuth2 integrations, we need user-specific auth
      if (integration.authType === "OAUTH2") {
        return NextResponse.json(
          {
            error: "User authentication required",
            message:
              "This integration requires individual user authentication. Please authenticate with Jira in the integration settings.",
            authType: integration.authType,
          },
          { status: 401 }
        );
      }

      // API_KEY and PERSONAL_ACCESS_TOKEN integrations can proceed
      // console.log(
      //   `Using ${integration.authType} authentication for integration ${integrationId}`
      // );
    } else {
      integration = userIntegrationAuth.integration;
    }

    // Get the internal TestPlanIt project ID from the request or from linked entities
    let internalProjectId: number = validatedData.testplanitProjectId || 0;

    // Check project permissions if linking to TestPlanit entities
    if (
      validatedData.testCaseId ||
      validatedData.testRunId ||
      validatedData.sessionId
    ) {
      // Get the project ID from the linked entity
      let entityProjectId: number | null = null;

      if (validatedData.testCaseId) {
        const testCase = await prisma.repositoryCases.findUnique({
          where: { id: parseInt(validatedData.testCaseId) },
          select: { projectId: true },
        });
        entityProjectId = testCase?.projectId || null;
      } else if (validatedData.testRunId) {
        const testRun = await prisma.testRuns.findUnique({
          where: { id: parseInt(validatedData.testRunId) },
          select: { projectId: true },
        });
        entityProjectId = testRun?.projectId || null;
      } else if (validatedData.sessionId) {
        const sessionEntity = await prisma.sessions.findUnique({
          where: { id: parseInt(validatedData.sessionId) },
          select: { projectId: true },
        });
        entityProjectId = sessionEntity?.projectId || null;
      }

      // Use entity's project ID as fallback if not provided in request
      if (!internalProjectId && entityProjectId) {
        internalProjectId = entityProjectId;
      }

      if (entityProjectId) {
        // Check if user has access to the project
        const projectAssignment = await prisma.projectAssignment.findUnique({
          where: {
            userId_projectId: {
              userId: session.user.id,
              projectId: entityProjectId,
            },
          },
        });

        if (!projectAssignment) {
          return NextResponse.json(
            { error: "You do not have access to this project" },
            { status: 403 }
          );
        }
      }
    }

    // Initialize adapter through IntegrationManager
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    // Try to find the Jira user for the current TestPlanIt user
    let reporterId: string | undefined;

    // console.log(`[CREATE-ISSUE] Current TestPlanIt user: ${session.user.name} - ${session.user.email} (ID: ${session.user.id})`);
    // console.log(`[CREATE-ISSUE] Has userIntegrationAuth: ${!!userIntegrationAuth}`);
    // console.log(`[CREATE-ISSUE] Integration provider: ${integration?.provider || userIntegrationAuth?.integration?.provider}`);
    // console.log(`[CREATE-ISSUE] Integration auth type: ${integration?.authType || userIntegrationAuth?.integration?.authType}`);

    // Helper to normalize searchUsers response (handles both old array and new object format)
    const normalizeUsersResponse = (response: any) => {
      if (Array.isArray(response)) {
        return response;
      }
      return response?.users || [];
    };

    // For OAuth integrations with user auth, the reporter will be set automatically by Jira
    // For API key integrations, we need to find the user
    if (!userIntegrationAuth && adapter.searchUsers) {
      try {
        // console.log(`[CREATE-ISSUE] Using API key auth - searching for Jira user`);

        // First, get all assignable users for the project to have a complete list
        // console.log(`[CREATE-ISSUE] Getting all assignable users for project: ${validatedData.projectId}`);
        const allProjectUsersResponse = await adapter.searchUsers(
          "",
          validatedData.projectId
        );
        const allProjectUsers = normalizeUsersResponse(allProjectUsersResponse);
        // console.log(`[CREATE-ISSUE] Found ${allProjectUsers.length} total project users`);
        // allProjectUsers.forEach((user, index) => {
        //   console.log(`[CREATE-ISSUE] Project User ${index + 1}: ${user.displayName} - Email: ${user.emailAddress || 'NO EMAIL'} - AccountId: ${user.accountId}`);
        // });

        // Strategy 1: Try to find by email if available
        let matchingUser: any = null;
        if (session.user.email) {
          // console.log(`[CREATE-ISSUE] Looking for email match: ${session.user.email}`);

          // Check in all project users first
          matchingUser = allProjectUsers.find(
            (user: any) =>
              user.emailAddress &&
              user.emailAddress.toLowerCase() ===
                session.user.email?.toLowerCase()
          );

          if (matchingUser) {
            reporterId = matchingUser.accountId;
            // console.log(`[CREATE-ISSUE] ✅ Found by email match in project users: ${matchingUser.displayName} (${matchingUser.accountId}`);
          }
        }

        // Strategy 2: If no email match, try name matching
        if (!reporterId && session.user.name) {
          // console.log(`[CREATE-ISSUE] Attempting name match for: "${session.user.name}"`);

          const nameToMatch = session.user.name.toLowerCase().trim();

          // Try exact match first
          matchingUser = allProjectUsers.find(
            (user: any) =>
              user.displayName &&
              user.displayName.toLowerCase().trim() === nameToMatch
          );

          if (matchingUser) {
            reporterId = matchingUser.accountId;
            // console.log(`[CREATE-ISSUE] ✅ Found by exact name match: ${matchingUser.displayName} (${matchingUser.accountId}`);
          } else {
            // If the TestPlanIt user is just "brad" and there's a Jira user "brad", match them
            const singleNameMatch = allProjectUsers.find((user: any) => {
              if (!user.displayName) return false;
              const jiraName = user.displayName.toLowerCase().trim();
              // Match if Jira name is exactly the TestPlanIt name
              if (jiraName === nameToMatch) return true;
              // Also match if TestPlanIt name is first part of Jira name (e.g., "brad" matches "Brad DerManouelian")
              const jiraFirstName = jiraName.split(/\s+/)[0];
              return jiraFirstName === nameToMatch;
            });

            if (singleNameMatch) {
              reporterId = singleNameMatch.accountId;
              // console.log(`[CREATE-ISSUE] ✅ Found by first name match: ${singleNameMatch.displayName} (${singleNameMatch.accountId}`);
            }
          }
        }

        // Additional email search if we still don't have a match
        if (!reporterId && session.user.email) {
          // console.log(`[CREATE-ISSUE] Searching more broadly by email: ${session.user.email}`);
          const emailUsersResponse = await adapter.searchUsers(
            session.user.email,
            validatedData.projectId
          );
          const emailUsers = normalizeUsersResponse(emailUsersResponse);

          // console.log(`[CREATE-ISSUE] Found ${emailUsers.length} users from email search`);
          // emailUsers.forEach((user, index) => {
          //   console.log(`[CREATE-ISSUE] Email User ${index + 1}: ${user.displayName} - Email: ${user.emailAddress || 'NO EMAIL'} - AccountId: ${user.accountId}`);
          // });

          // Try to find match in the additional email search results if not already found
          if (!reporterId && emailUsers.length > 0) {
            // Try exact email match
            matchingUser = emailUsers.find(
              (user: any) =>
                user.emailAddress &&
                user.emailAddress.toLowerCase() ===
                  session.user.email?.toLowerCase()
            );

            if (matchingUser) {
              reporterId = matchingUser.accountId;
              // console.log(`[CREATE-ISSUE] ✅ Found by email match in search results: ${matchingUser.displayName} (${matchingUser.accountId}`);
            }
          }
        }

        if (!reporterId) {
          // console.log(`[CREATE-ISSUE] ❌ Could not find matching Jira user for: ${session.user.name} / ${session.user.email}`);

          // Fallback: Use the API key owner as reporter
          if (adapter.getCurrentUser) {
            // console.log(`[CREATE-ISSUE] Attempting to use API key owner as fallback reporter`);
            try {
              const apiKeyUser = await adapter.getCurrentUser();
              if (apiKeyUser) {
                reporterId = apiKeyUser.accountId;
                // console.log(`[CREATE-ISSUE] ⚠️ Using API key owner as fallback: ${apiKeyUser.displayName} (${apiKeyUser.accountId}`);
              }
            } catch (error) {
              console.error(
                "[CREATE-ISSUE] Failed to get API key owner:",
                error
              );
            }
          }
        }
      } catch (error) {
        console.error("[CREATE-ISSUE] Error searching for Jira user:", error);
        // Continue without setting reporter
      }
    } else {
      // console.log(`[CREATE-ISSUE] Skipping user search - OAuth auth or no adapter: userAuth=${!!userIntegrationAuth}, hasSearchUsers=${!!adapter.searchUsers}`);
    }

    // Create issue using the adapter
    const issueData = {
      title: validatedData.title,
      description: validatedData.description,
      projectId: validatedData.projectId,
      issueType: validatedData.issueType,
      priority: validatedData.priority,
      assigneeId: validatedData.assigneeId,
      labels: validatedData.labels,
      customFields: validatedData.customFields,
    };

    // Add reporter to customFields if found
    if (reporterId) {
      // console.log(`[CREATE-ISSUE] Adding reporter to issue data: ${reporterId}`);
      issueData.customFields = {
        ...issueData.customFields,
        reporter: { accountId: reporterId },
      };
    } else {
      // console.log(`[CREATE-ISSUE] No reporter ID found - issue will be created with default reporter`);
    }

    // console.log(`[CREATE-ISSUE] Final issue data being sent:`, JSON.stringify(issueData, null, 2));
    const createdIssue = await adapter.createIssue(issueData);

    // If linked to TestPlanit entities, create the link in our database
    if (
      validatedData.testCaseId ||
      validatedData.testRunId ||
      validatedData.sessionId ||
      validatedData.testRunResultId ||
      validatedData.testRunStepResultId
    ) {
      // Use upsert to handle cases where the issue already exists
      const issue = await prisma.issue.upsert({
        where: {
          externalId_integrationId: {
            externalId: createdIssue.key || createdIssue.id,
            integrationId: parseInt(integrationId),
          },
        },
        create: {
          name: createdIssue.title,
          title: createdIssue.title, // Use the same value for title
          externalId: createdIssue.key || createdIssue.id,
          data: {
            id: createdIssue.id,
            key: createdIssue.key,
            url: createdIssue.url,
            status: createdIssue.status,
            priority: createdIssue.priority,
            assignee: createdIssue.assignee,
            reporter: createdIssue.reporter,
            labels: createdIssue.labels,
            customFields: createdIssue.customFields,
          },
          integrationId: parseInt(integrationId),
          // Use the internal TestPlanIt project ID (from request or derived from linked entities)
          projectId: internalProjectId,
          createdById: session.user.id,
          // Link to the appropriate entities
          ...(validatedData.testCaseId && {
            repositoryCases: {
              connect: { id: parseInt(validatedData.testCaseId) },
            },
          }),
          ...(validatedData.testRunId && {
            testRuns: {
              connect: { id: parseInt(validatedData.testRunId) },
            },
          }),
          ...(validatedData.sessionId && {
            sessions: {
              connect: { id: parseInt(validatedData.sessionId) },
            },
          }),
          ...(validatedData.testRunResultId && {
            testRunResults: {
              connect: { id: parseInt(validatedData.testRunResultId) },
            },
          }),
          ...(validatedData.testRunStepResultId && {
            testRunStepResults: {
              connect: { id: parseInt(validatedData.testRunStepResultId) },
            },
          }),
        },
        update: {
          // Update fields that might have changed
          title: createdIssue.title,
          data: {
            id: createdIssue.id,
            key: createdIssue.key,
            url: createdIssue.url,
            status: createdIssue.status,
            priority: createdIssue.priority,
            assignee: createdIssue.assignee,
            reporter: createdIssue.reporter,
            labels: createdIssue.labels,
            customFields: createdIssue.customFields,
          },
          // Also connect any new relationships
          ...(validatedData.testCaseId && {
            repositoryCases: {
              connect: { id: parseInt(validatedData.testCaseId) },
            },
          }),
          ...(validatedData.testRunId && {
            testRuns: {
              connect: { id: parseInt(validatedData.testRunId) },
            },
          }),
          ...(validatedData.sessionId && {
            sessions: {
              connect: { id: parseInt(validatedData.sessionId) },
            },
          }),
          ...(validatedData.testRunResultId && {
            testRunResults: {
              connect: { id: parseInt(validatedData.testRunResultId) },
            },
          }),
          ...(validatedData.testRunStepResultId && {
            testRunStepResults: {
              connect: { id: parseInt(validatedData.testRunStepResultId) },
            },
          }),
        },
      });

      return NextResponse.json({
        ...createdIssue,
        internalId: issue.id,
      });
    }

    return NextResponse.json(createdIssue);
  } catch (error) {
    console.error("Error creating issue:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message.includes("401")) {
      return NextResponse.json(
        {
          error: "Integration authentication expired. Please re-authenticate.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to create issue",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
