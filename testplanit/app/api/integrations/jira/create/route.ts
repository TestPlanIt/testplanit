import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { JiraAdapter } from "@/lib/integrations/adapters/JiraAdapter";
import { prisma } from "@/lib/prisma";
import { z } from "zod/v4";

const createIssueSchema = z.object({
  projectKey: z.string(),
  issueType: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  testCaseId: z.string().optional(),
  testRunId: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createIssueSchema.parse(body);

    // Get user's Jira integration auth
    const userIntegrationAuth = await prisma.userIntegrationAuth.findFirst({
      where: {
        userId: session.user.id,
        integration: {
          provider: "JIRA",
          status: "ACTIVE",
        },
        isActive: true,
      },
      include: {
        integration: true,
      },
    });

    if (!userIntegrationAuth) {
      return NextResponse.json(
        { error: "Jira integration not configured or authenticated" },
        { status: 400 }
      );
    }

    // Initialize Jira adapter
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(
      userIntegrationAuth.integrationId.toString()
    );

    if (!(adapter instanceof JiraAdapter)) {
      return NextResponse.json(
        { error: "Invalid integration type" },
        { status: 400 }
      );
    }

    // Prepare issue data for Jira
    const issueData = {
      projectId: validatedData.projectKey,
      title: validatedData.summary,
      description: validatedData.description || "",
      issueType: validatedData.issueType,
      priority: validatedData.priority,
      labels: validatedData.labels,
      customFields: validatedData.customFields,
    };

    // Create issue in Jira
    const createdIssue = await adapter.createIssue(issueData);

    // If linked to a test case, session, or test run, create the link in our database
    if (
      validatedData.testCaseId ||
      validatedData.testRunId ||
      validatedData.sessionId
    ) {
      // Use upsert to handle cases where the issue already exists
      const issue = await prisma.issue.upsert({
        where: {
          externalId_integrationId: {
            externalId: createdIssue.key || createdIssue.id,
            integrationId: userIntegrationAuth.integrationId,
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
            type: issueData.issueType,
            priority: createdIssue.priority,
          },
          integrationId: userIntegrationAuth.integrationId,
          projectId: validatedData.projectId || 0, // Project ID should be provided
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
        },
        update: {
          // Update fields that might have changed
          title: createdIssue.title,
          data: {
            id: createdIssue.id,
            key: createdIssue.key,
            url: createdIssue.url,
            status: createdIssue.status,
            type: issueData.issueType,
            priority: createdIssue.priority,
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
        },
      });
    }

    return NextResponse.json({
      id: createdIssue.id,
      key: createdIssue.key,
      url: createdIssue.url,
      summary: createdIssue.title,
      status: createdIssue.status,
      type: issueData.issueType,
      priority: createdIssue.priority,
    });
  } catch (error) {
    console.error("Error creating Jira issue:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message.includes("401")) {
      return NextResponse.json(
        { error: "Jira authentication expired. Please re-authenticate." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create issue" },
      { status: 500 }
    );
  }
}
