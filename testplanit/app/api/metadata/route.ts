import { NextRequest, NextResponse } from "next/server";
import { enhance } from "@zenstackhq/runtime";
import { db } from "~/server/db";

/**
 * Public metadata API for Open Graph link previews.
 * Returns minimal, non-sensitive information (names only) for link sharing.
 * Uses ZenStack enhanced client with anonymous access.
 */

// Get enhanced Prisma client for anonymous access (public metadata only)
function getAnonymousDb() {
  return enhance(db, { user: undefined });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json(
      { error: "Missing type or id parameter" },
      { status: 400 }
    );
  }

  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const prisma = getAnonymousDb();

  try {
    switch (type) {
      case "test-run": {
        const testRun = await prisma.testRuns.findUnique({
          where: { id: numericId },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true } },
            _count: { select: { testCases: true } },
          },
        });
        if (!testRun || testRun.isDeleted) {
          return NextResponse.json({ title: "Test Run", description: "" });
        }
        return NextResponse.json({
          title: `${testRun.name} | ${testRun.project.name}`,
          description: `Test run with ${testRun._count.testCases} test cases in ${testRun.project.name}`,
        });
      }

      case "test-case": {
        const testCase = await prisma.repositoryCases.findUnique({
          where: { id: numericId },
          select: {
            name: true,
            repositoryId: true,
            isDeleted: true,
            project: { select: { name: true } },
          },
        });
        if (!testCase || testCase.isDeleted) {
          return NextResponse.json({ title: "Test Case", description: "" });
        }
        return NextResponse.json({
          title: `C${testCase.repositoryId}: ${testCase.name} | ${testCase.project.name}`,
          description: `Test case in ${testCase.project.name}`,
        });
      }

      case "session": {
        const session = await prisma.sessions.findUnique({
          where: { id: numericId },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true } },
          },
        });
        if (!session || session.isDeleted) {
          return NextResponse.json({
            title: "Exploratory Session",
            description: "",
          });
        }
        return NextResponse.json({
          title: `${session.name} | ${session.project.name}`,
          description: `Exploratory testing session in ${session.project.name}`,
        });
      }

      case "project": {
        const project = await prisma.projects.findUnique({
          where: { id: numericId },
          select: {
            name: true,
            isDeleted: true,
            _count: {
              select: {
                repositoryCases: { where: { isDeleted: false } },
                testRuns: { where: { isDeleted: false } },
              },
            },
          },
        });
        if (!project || project.isDeleted) {
          return NextResponse.json({ title: "Project", description: "" });
        }
        return NextResponse.json({
          title: project.name,
          description: `${project._count.repositoryCases} test cases, ${project._count.testRuns} test runs`,
        });
      }

      case "milestone": {
        const milestone = await prisma.milestones.findUnique({
          where: { id: numericId },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true } },
          },
        });
        if (!milestone || milestone.isDeleted) {
          return NextResponse.json({ title: "Milestone", description: "" });
        }
        return NextResponse.json({
          title: `${milestone.name} | ${milestone.project.name}`,
          description: `Milestone in ${milestone.project.name}`,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch (error) {
    console.error("Metadata API error:", error);
    return NextResponse.json({ title: "TestPlanIt", description: "" });
  }
}
