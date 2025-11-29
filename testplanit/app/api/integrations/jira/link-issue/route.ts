import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { JiraLinkService } from "@/lib/services/jira-link-service";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

const linkIssueSchema = z.object({
  testCaseId: z.number().optional(),
  testRunId: z.number().optional(),
  testRunResultId: z.number().optional(),
  testRunStepResultId: z.number().optional(),
  sessionId: z.number().optional(),
  sessionResultId: z.number().optional(),
  jiraIssueKey: z.string(),
  jiraIssueId: z.string(),
  integrationId: z.number(),
  issueTitle: z.string().optional(),
  issueUrl: z.string().optional(),
}).refine((data) => data.testCaseId || data.testRunId || data.testRunResultId || data.testRunStepResultId || data.sessionId || data.sessionResultId, {
    error: "One of testCaseId, testRunId, testRunResultId, testRunStepResultId, sessionId, or sessionResultId must be provided"
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const linkData = linkIssueSchema.parse(body);

    if (linkData.testCaseId) {
      await JiraLinkService.linkTestCaseToJiraIssue(
        linkData.testCaseId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    if (linkData.testRunId) {
      await JiraLinkService.linkTestRunToJiraIssue(
        linkData.testRunId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    if (linkData.testRunResultId) {
      await JiraLinkService.linkTestRunResultToJiraIssue(
        linkData.testRunResultId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    if (linkData.sessionId) {
      await JiraLinkService.linkSessionToJiraIssue(
        linkData.sessionId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    if (linkData.sessionResultId) {
      await JiraLinkService.linkSessionResultToJiraIssue(
        linkData.sessionResultId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    if (linkData.testRunStepResultId) {
      await JiraLinkService.linkTestRunStepResultToJiraIssue(
        linkData.testRunStepResultId,
        linkData.jiraIssueKey,
        linkData.jiraIssueId,
        linkData.integrationId,
        linkData.issueTitle,
        linkData.issueUrl
      );
    }

    // Fetch the linked issues to return the created issue with its database ID
    let linkedIssues = [];
    if (linkData.testCaseId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssues(linkData.testCaseId);
    } else if (linkData.testRunId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRun(linkData.testRunId);
    } else if (linkData.testRunResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRunResult(linkData.testRunResultId);
    } else if (linkData.testRunStepResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRunStepResult(linkData.testRunStepResultId);
    } else if (linkData.sessionId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForSession(linkData.sessionId);
    } else if (linkData.sessionResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForSessionResult(linkData.sessionResultId);
    }

    return NextResponse.json({
      success: true,
      message: "Successfully linked to Jira issue",
      linkedIssues,
    });
  } catch (error) {
    console.error("Error linking to Jira issue:", error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : "Failed to link issue",
      },
      { status: 500 }
    );
  }
}

const unlinkIssueSchema = z.object({
  testCaseId: z.number().optional(),
  testRunId: z.number().optional(),
  testRunResultId: z.number().optional(),
  testRunStepResultId: z.number().optional(),
  sessionId: z.number().optional(),
  sessionResultId: z.number().optional(),
  jiraIssueId: z.string(),
}).refine((data) => data.testCaseId || data.testRunId || data.testRunResultId || data.testRunStepResultId || data.sessionId || data.sessionResultId, {
    error: "One of testCaseId, testRunId, testRunResultId, testRunStepResultId, sessionId, or sessionResultId must be provided"
});

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const unlinkData = unlinkIssueSchema.parse(body);

    if (unlinkData.testCaseId) {
      await JiraLinkService.unlinkTestCaseFromJiraIssue(
        unlinkData.testCaseId,
        unlinkData.jiraIssueId
      );
    } else if (unlinkData.testRunId) {
      await JiraLinkService.unlinkTestRunFromJiraIssue(
        unlinkData.testRunId,
        unlinkData.jiraIssueId
      );
    } else if (unlinkData.testRunResultId) {
      await JiraLinkService.unlinkTestRunResultFromJiraIssue(
        unlinkData.testRunResultId,
        unlinkData.jiraIssueId
      );
    } else if (unlinkData.sessionId) {
      await JiraLinkService.unlinkSessionFromJiraIssue(
        unlinkData.sessionId,
        unlinkData.jiraIssueId
      );
    } else if (unlinkData.sessionResultId) {
      await JiraLinkService.unlinkSessionResultFromJiraIssue(
        unlinkData.sessionResultId,
        unlinkData.jiraIssueId
      );
    } else if (unlinkData.testRunStepResultId) {
      await JiraLinkService.unlinkTestRunStepResultFromJiraIssue(
        unlinkData.testRunStepResultId,
        unlinkData.jiraIssueId
      );
    }

    return NextResponse.json({
      success: true,
      message: "Successfully unlinked from Jira issue",
    });
  } catch (error) {
    console.error("Error unlinking from Jira issue:", error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : "Failed to unlink issue",
      },
      { status: 500 }
    );
  }
}

const getLinkedIssuesSchema = z.object({
  testCaseId: z.string().transform(Number).optional(),
  testRunId: z.string().transform(Number).optional(),
  testRunResultId: z.string().transform(Number).optional(),
  testRunStepResultId: z.string().transform(Number).optional(),
  sessionId: z.string().transform(Number).optional(),
  sessionResultId: z.string().transform(Number).optional(),
}).refine((data) => data.testCaseId || data.testRunId || data.testRunResultId || data.testRunStepResultId || data.sessionId || data.sessionResultId, {
    error: "One of testCaseId, testRunId, testRunResultId, testRunStepResultId, sessionId, or sessionResultId must be provided"
});

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
    const params = getLinkedIssuesSchema.parse({
      testCaseId: searchParams.get("testCaseId") || undefined,
      testRunId: searchParams.get("testRunId") || undefined,
      testRunResultId: searchParams.get("testRunResultId") || undefined,
      testRunStepResultId: searchParams.get("testRunStepResultId") || undefined,
      sessionId: searchParams.get("sessionId") || undefined,
      sessionResultId: searchParams.get("sessionResultId") || undefined,
    });

    let linkedIssues = [];
    if (params.testCaseId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssues(params.testCaseId);
    } else if (params.testRunId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRun(params.testRunId);
    } else if (params.testRunResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRunResult(params.testRunResultId);
    } else if (params.testRunStepResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForTestRunStepResult(params.testRunStepResultId);
    } else if (params.sessionId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForSession(params.sessionId);
    } else if (params.sessionResultId) {
      linkedIssues = await JiraLinkService.getLinkedJiraIssuesForSessionResult(params.sessionResultId);
    }

    return NextResponse.json({
      success: true,
      linkedIssues,
    });
  } catch (error) {
    console.error("Error getting linked Jira issues:", error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : "Failed to get linked issues",
      },
      { status: 500 }
    );
  }
}