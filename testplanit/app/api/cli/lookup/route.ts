/**
 * CLI Lookup API Route
 *
 * Allows the CLI to look up entities by name and get their IDs.
 * Supports: projects, workflow states, configurations, milestones, tags, folders, test runs
 */

import { baseDb } from "@/lib/db";
import { WorkflowScope } from "~/zenstack/models";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";

interface LookupRequest {
  projectId?: number; // Not required for project lookup
  type:
    "project" | "state" | "config" | "milestone" | "tag" | "folder" | "testRun";
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
        const project = await baseDb.projects.findFirst({
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
        const state = await baseDb.workflows.findFirst({
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
        // Look up configuration by name. When a projectId is supplied, scope to
        // configurations assigned to that project (configurations are
        // project-scoped); otherwise fall back to a global lookup.
        const config = await baseDb.configurations.findFirst({
          where: {
            name: name,
            isDeleted: false,
            isEnabled: true,
            ...(projectId ? { projects: { some: { projectId } } } : {}),
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
        const milestone = await baseDb.milestones.findFirst({
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
        // Look up tag by name (tags are global). Case-insensitive, matching
        // every other tag-creation path in the app (see
        // app/api/admin/tags/create/route.ts) — an exact-case match here let
        // CI jobs recreate "regression"/"Regression"-style duplicates
        // whenever a run submitted a different casing than what existed.
        let tag = await baseDb.tags.findFirst({
          where: {
            name: { equals: name, mode: "insensitive" },
            isDeleted: false,
          },
          select: { id: true, name: true },
        });

        if (!tag && createIfMissing) {
          // A case-variant may exist soft-deleted — restore it instead of
          // creating a fresh duplicate.
          const deletedTag = await baseDb.tags.findFirst({
            where: {
              name: { equals: name, mode: "insensitive" },
              isDeleted: true,
            },
            select: { id: true },
          });

          try {
            tag = deletedTag
              ? await baseDb.tags.update({
                  where: { id: deletedTag.id },
                  data: { isDeleted: false },
                  select: { id: true, name: true },
                })
              : await baseDb.tags.create({
                  data: { name: name },
                  select: { id: true, name: true },
                });
          } catch (err) {
            // Race: another request created/restored a case-variant between
            // the lookup above and this write. Fall back to the same
            // case-insensitive detection rather than surfacing a 500.
            if (isUniqueConstraintError(err)) {
              tag = await baseDb.tags.findFirst({
                where: {
                  name: { equals: name, mode: "insensitive" },
                  isDeleted: false,
                },
                select: { id: true, name: true },
              });
            }
            if (!tag) throw err;
          }
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
        const repository = await baseDb.repositories.findFirst({
          where: {
            projectId: projectId,
            isActive: true,
            isArchived: false,
            isDeleted: false,
          },
        });

        if (!repository) {
          return NextResponse.json(
            {
              error: `No active repository found for project ${projectId}`,
              code: "NOT_FOUND",
            },
            { status: 404 }
          );
        }

        const folder = await baseDb.repositoryFolders.findFirst({
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
        const testRun = await baseDb.testRuns.findFirst({
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
