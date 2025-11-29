import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { JiraAdapter } from "@/lib/integrations/adapters/JiraAdapter";
import { prisma } from "@/lib/prisma";
import { z } from "zod/v4";

const searchSchema = z.object({
  query: z.string().optional(),
  projectId: z.string().optional(),
  status: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  limit: z.number().min(1).max(100).prefault(50),
  offset: z.number().min(0).prefault(0),
});

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse search params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);

    // Handle array parameters
    const params = {
      ...searchParams,
      status: searchParams.status ? searchParams.status.split(",") : undefined,
      labels: searchParams.labels ? searchParams.labels.split(",") : undefined,
      limit: searchParams.limit ? parseInt(searchParams.limit) : undefined,
      offset: searchParams.offset ? parseInt(searchParams.offset) : undefined,
    };

    const validatedParams = searchSchema.parse(params);

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

    // Search issues in Jira
    const searchResults = await adapter.searchIssues(validatedParams);

    // Get existing issue links to mark which issues are already linked
    const issueKeys = searchResults.issues
      .map((issue) => issue.key)
      .filter(Boolean) as string[];

    let existingIssues: any[] = [];
    if (issueKeys.length > 0) {
      existingIssues = await prisma.issue.findMany({
        where: {
          externalId: { in: issueKeys },
          integrationId: userIntegrationAuth.integrationId,
          isDeleted: false,
        },
        include: {
          repositoryCases: {
            select: {
              id: true,
              name: true,
            },
          },
          testRuns: {
            select: {
              id: true,
              name: true,
            },
          },
          sessions: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    }

    const existingIssueMap = new Map(
      existingIssues.map((issue) => [issue.externalId, issue])
    );

    // Format response
    const issues = searchResults.issues.map((issue) => {
      const existingIssue = existingIssueMap.get(issue.key || "");

      return {
        id: issue.id,
        key: issue.key,
        url: issue.url,
        summary: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        reporter: issue.reporter,
        labels: issue.labels,
        created: issue.createdAt,
        updated: issue.updatedAt,
        linkedTo: existingIssue
          ? {
              issueId: existingIssue.id,
              testCases: existingIssue.repositoryCases,
              testRuns: existingIssue.testRuns,
              sessions: existingIssue.sessions,
            }
          : null,
      };
    });

    return NextResponse.json({
      issues,
      total: searchResults.total,
      offset: validatedParams.offset,
      limit: validatedParams.limit,
      hasMore: searchResults.hasMore,
    });
  } catch (error) {
    console.error("Error searching Jira issues:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid search parameters", details: error.issues },
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
      { error: "Failed to search issues" },
      { status: 500 }
    );
  }
}
