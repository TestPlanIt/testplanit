import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const issueKey = searchParams.get("issueKey");
    const integrationId = searchParams.get("integrationId");

    if (!issueKey || !integrationId) {
      return NextResponse.json(
        { error: "Missing issueKey or integrationId parameter" },
        { status: 400 }
      );
    }

    // For now, return a simplified response until we have proper Jira integration
    // This is a placeholder that can be extended when full Jira integration is available
    return NextResponse.json({
      key: issueKey,
      summary: `Issue ${issueKey}`,
      description: `Detailed description for ${issueKey} would be fetched from Jira here.`,
      status: {
        name: "Open"
      },
      priority: {
        name: "Medium"
      },
      issueType: {
        name: "Story"
      },
      comments: [
        {
          author: {
            displayName: "System"
          },
          body: "This is a placeholder for Jira comments. Full integration coming soon.",
          created: new Date().toISOString()
        }
      ]
    });
  } catch (error) {
    console.error("Error in GET /api/integrations/jira/issue-details-with-comments:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    return NextResponse.json(
      { error: "Failed to fetch issue details", details: errorMessage },
      { status: 500 }
    );
  }
}