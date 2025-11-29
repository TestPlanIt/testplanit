import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const issueKey = searchParams.get("issueKey");
    const integrationId = searchParams.get("integrationId");

    if (!issueKey || !integrationId) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Use IntegrationManager to get the adapter
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Integration not found or not active" },
        { status: 404 }
      );
    }

    // Use the adapter's getIssue method
    const issueData = await adapter.getIssue(issueKey);

    // Transform to match the expected format for the UI
    // The adapter's getIssue method already fetches all the needed data
    const issueDetails = {
      key: issueData.key,
      summary: issueData.title,
      description: issueData.description,
      status: {
        name: issueData.status,
        // Map common status names to colors
        color: issueData.status?.toLowerCase() === 'done' ? 'green' :
               issueData.status?.toLowerCase() === 'in progress' ? 'blue' :
               issueData.status?.toLowerCase() === 'to do' || issueData.status?.toLowerCase() === 'todo' ? 'yellow' : 
               'gray',
      },
      priority: issueData.priority ? {
        name: issueData.priority,
        iconUrl: undefined, // Not provided by the IssueData interface
      } : null,
      assignee: issueData.assignee ? {
        displayName: issueData.assignee.name,
        avatarUrl: undefined, // Not provided by the IssueData interface
      } : null,
      reporter: issueData.reporter ? {
        displayName: issueData.reporter.name,
        avatarUrl: undefined, // Not provided by the IssueData interface
      } : null,
      issueType: issueData.issueType ? {
        name: issueData.issueType.name,
        iconUrl: issueData.issueType.iconUrl,
      } : {
        name: 'Issue', // Default type
        iconUrl: undefined,
      },
      created: issueData.createdAt?.toISOString(),
      updated: issueData.updatedAt?.toISOString(),
    };

    return NextResponse.json(issueDetails);
  } catch (error: any) {
    console.error("Error fetching Jira issue details:", error);
    
    // Check if it's an authentication error
    if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Authentication failed. Please check integration credentials." },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: error.message || "Failed to fetch issue details" },
      { status: 500 }
    );
  }
}