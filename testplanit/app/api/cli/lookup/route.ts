/**
 * CLI Lookup API Route
 *
 * Allows the CLI to look up entities by name and get their IDs.
 * Supports: projects, workflow states, configurations, milestones, tags, folders, test runs
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { WorkflowScope } from "@prisma/client";

interface LookupRequest {
  projectId?: number; // Not required for project lookup
  type: "project" | "state" | "config" | "milestone" | "tag" | "folder" | "testRun";
  name: string;
  createIfMissing?: boolean; // Only applicable for tags
}

interface LookupResponse {
  id: number;
  name: string;
  created?: boolean;
}

export async function POST(request: NextRequest) {
  // Authenticate
  const session = await getServerAuthSession();
  let userId: string | undefined = session?.user?.id;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return NextResponse.json(
        { error: apiAuth.error, code: apiAuth.errorCode },
        { status: 401 }
      );
    }
    userId = apiAuth.userId;
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: LookupRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, type, name, createIfMissing } = body;

  if (!type || !name) {
    return NextResponse.json(
      { error: "Missing required fields: type, name" },
      { status: 400 }
    );
  }

  // projectId is required for all types except project, config, and tag
  if (!projectId && !["project", "config", "tag"].includes(type)) {
    return NextResponse.json(
      { error: "projectId is required for this lookup type" },
      { status: 400 }
    );
  }

  try {
    let result: LookupResponse | null = null;

    switch (type) {
      case "project": {
        // Look up project by name
        const project = await prisma.projects.findFirst({
          where: {
            name: name,
            isDeleted: false,
          },
          select: { id: true, name: true },
        });

        if (!project) {
          return NextResponse.json(
            { error: `Project "${name}" not found`, code: "NOT_FOUND" },
            { status: 404 }
          );
        }
        result = { id: project.id, name: project.name };
        break;
      }

      case "state": {
        // Look up workflow state by name (scoped to RUNS for test runs)
        const state = await prisma.workflows.findFirst({
          where: {
            name: name,
            scope: WorkflowScope.RUNS,
            isDeleted: false,
            isEnabled: true,
            projects: {
              some: {
                projectId: projectId,
              },
            },
          },
          select: { id: true, name: true },
        });

        if (!state) {
          return NextResponse.json(
            {
              error: `Workflow state "${name}" not found for project ${projectId}`,
              code: "NOT_FOUND",
            },
            { status: 404 }
          );
        }
        result = { id: state.id, name: state.name };
        break;
      }

      case "config": {
        // Look up configuration by name
        const config = await prisma.configurations.findFirst({
          where: {
            name: name,
            isDeleted: false,
            isEnabled: true,
          },
          select: { id: true, name: true },
        });

        if (!config) {
          return NextResponse.json(
            { error: `Configuration "${name}" not found`, code: "NOT_FOUND" },
            { status: 404 }
          );
        }
        result = { id: config.id, name: config.name };
        break;
      }

      case "milestone": {
        // Look up milestone by name within the project
        const milestone = await prisma.milestones.findFirst({
          where: {
            projectId: projectId,
            name: name,
            isDeleted: false,
          },
          select: { id: true, name: true },
        });

        if (!milestone) {
          return NextResponse.json(
            {
              error: `Milestone "${name}" not found in project ${projectId}`,
              code: "NOT_FOUND",
            },
            { status: 404 }
          );
        }
        result = { id: milestone.id, name: milestone.name };
        break;
      }

      case "tag": {
        // Look up tag by name (tags are global)
        let tag = await prisma.tags.findFirst({
          where: {
            name: name,
            isDeleted: false,
          },
          select: { id: true, name: true },
        });

        if (!tag && createIfMissing) {
          // Create the tag if it doesn't exist
          tag = await prisma.tags.create({
            data: { name: name },
            select: { id: true, name: true },
          });
          result = { id: tag.id, name: tag.name, created: true };
        } else if (!tag) {
          return NextResponse.json(
            { error: `Tag "${name}" not found`, code: "NOT_FOUND" },
            { status: 404 }
          );
        } else {
          result = { id: tag.id, name: tag.name };
        }
        break;
      }

      case "folder": {
        // Look up folder by name within the project
        // First, get the active repository for the project
        const repository = await prisma.repositories.findFirst({
          where: {
            projectId: projectId,
            isActive: true,
            isArchived: false,
            isDeleted: false,
          },
        });

        if (!repository) {
          return NextResponse.json(
            { error: `No active repository found for project ${projectId}`, code: "NOT_FOUND" },
            { status: 404 }
          );
        }

        const folder = await prisma.repositoryFolders.findFirst({
          where: {
            projectId: projectId,
            repositoryId: repository.id,
            name: name,
            isDeleted: false,
          },
          select: { id: true, name: true },
        });

        if (!folder) {
          return NextResponse.json(
            {
              error: `Folder "${name}" not found in project ${projectId}`,
              code: "NOT_FOUND",
            },
            { status: 404 }
          );
        }
        result = { id: folder.id, name: folder.name };
        break;
      }

      case "testRun": {
        // Look up test run by name within the project
        const testRun = await prisma.testRuns.findFirst({
          where: {
            projectId: projectId,
            name: name,
            isDeleted: false,
          },
          orderBy: { createdAt: "desc" }, // Get the most recent if multiple exist
          select: { id: true, name: true },
        });

        if (!testRun) {
          return NextResponse.json(
            {
              error: `Test run "${name}" not found in project ${projectId}`,
              code: "NOT_FOUND",
            },
            { status: 404 }
          );
        }
        result = { id: testRun.id, name: testRun.name };
        break;
      }

      default:
        return NextResponse.json(
          {
            error: `Invalid lookup type: ${type}. Valid types: project, state, config, milestone, tag, folder, testRun`,
          },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("CLI lookup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
