import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

const prisma = new PrismaClient();

export type SessionSummaryData = {
  sessionId: number;
  estimate: number | null;
  totalElapsed: number;
  commentsCount: number;
  results: Array<{
    id: number;
    createdAt: Date;
    elapsed: number | null;
    statusId: number;
    statusName: string;
    statusColorValue: string;
    issueIds: number[];
  }>;
  sessionIssues: Array<{
    id: number;
    name: string;
    title: string;
    externalId: string | null;
    externalKey: string | null;
    externalUrl: string | null;
    externalStatus: string | null;
    data: any;
    integrationId: number | null;
    lastSyncedAt: Date | null;
    integration: {
      id: number;
      provider: string;
      name: string;
    } | null;
  }>;
  resultIssues: Array<{
    id: number;
    name: string;
    title: string;
    externalId: string | null;
    externalKey: string | null;
    externalUrl: string | null;
    externalStatus: string | null;
    data: any;
    integrationId: number | null;
    lastSyncedAt: Date | null;
    integration: {
      id: number;
      provider: string;
      name: string;
    } | null;
  }>;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId: sessionIdParam } = await params;
  const sessionId = Number(sessionIdParam);

  if (isNaN(sessionId)) {
    return NextResponse.json(
      { error: "Invalid session ID" },
      { status: 400 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get session details
    const sessionData = await prisma.sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        estimate: true,
        issues: {
          select: {
            id: true,
            name: true,
            title: true,
            externalId: true,
            externalKey: true,
            externalUrl: true,
            externalStatus: true,
            data: true,
            integrationId: true,
            lastSyncedAt: true,
            integration: {
              select: {
                id: true,
                provider: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!sessionData) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Get session results with optimized query
    const results = await prisma.$queryRaw<
      Array<{
        id: number;
        createdAt: Date;
        elapsed: number | null;
        statusId: number;
        statusName: string;
        statusColorValue: string;
      }>
    >`
      SELECT
        sr.id,
        sr."createdAt",
        sr.elapsed,
        sr."statusId",
        s.name as "statusName",
        COALESCE(c.value, '#B1B2B3') as "statusColorValue"
      FROM "SessionResults" sr
      JOIN "Status" s ON sr."statusId" = s.id
      LEFT JOIN "Color" c ON s."colorId" = c.id
      WHERE sr."sessionId" = ${sessionId}
        AND sr."isDeleted" = false
      ORDER BY sr."createdAt" ASC
    `;

    // Get all issues linked to these results
    const resultIssuesMap = new Map<number, number[]>();
    if (results.length > 0) {
      const resultIds = results.map((r) => r.id);
      const issueLinks = await prisma.$queryRaw<
        Array<{
          sessionResultId: number;
          issueId: number;
        }>
      >`
        SELECT "A" as "sessionResultId", "B" as "issueId"
        FROM "_IssueToSessionResults"
        WHERE "A" = ANY(${resultIds}::int[])
      `;

      issueLinks.forEach((link) => {
        if (!resultIssuesMap.has(link.sessionResultId)) {
          resultIssuesMap.set(link.sessionResultId, []);
        }
        resultIssuesMap.get(link.sessionResultId)!.push(link.issueId);
      });
    }

    // Get unique issue IDs from all results
    const allResultIssueIds = new Set<number>();
    resultIssuesMap.forEach((issueIds) => {
      issueIds.forEach((id) => allResultIssueIds.add(id));
    });

    // Fetch all unique issues from results
    const resultIssues =
      allResultIssueIds.size > 0
        ? await prisma.issue.findMany({
            where: {
              id: { in: Array.from(allResultIssueIds) },
            },
            select: {
              id: true,
              name: true,
              title: true,
              externalId: true,
              externalKey: true,
              externalUrl: true,
              externalStatus: true,
              data: true,
              integrationId: true,
              lastSyncedAt: true,
              integration: {
                select: {
                  id: true,
                  provider: true,
                  name: true,
                },
              },
            },
          })
        : [];

    // Calculate total elapsed time
    const totalElapsed = results.reduce((sum, r) => sum + (r.elapsed || 0), 0);

    // Get comments count for this session
    const commentsCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Comment"
      WHERE "sessionId" = ${sessionId}
        AND "isDeleted" = false
    `;
    const commentsCount = Number(commentsCountResult[0]?.count || 0);

    // Map results with their issue IDs
    const resultsWithIssues = results.map((result) => ({
      ...result,
      issueIds: resultIssuesMap.get(result.id) || [],
    }));

    const response: SessionSummaryData = {
      sessionId: sessionData.id,
      estimate: sessionData.estimate,
      totalElapsed,
      commentsCount,
      results: resultsWithIssues,
      sessionIssues: sessionData.issues,
      resultIssues,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Session summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session summary" },
      { status: 500 }
    );
  }
}
