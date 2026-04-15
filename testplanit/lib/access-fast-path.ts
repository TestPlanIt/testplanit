/**
 * ZenStack fast path for project-scoped creates.
 *
 * The ZenStack CRUD endpoint evaluates an access-control policy on every
 * request; for project-scoped models this is the dominant CPU cost under
 * sustained mutation load.
 *
 * This module short-circuits that path for the narrow set of operations
 * where the answer is reliably determined by the user's access manifest:
 *
 *   - Authenticated request (session or API token)
 *   - Operation is `create` (extending to other ops is safe but not yet done)
 *   - Target model is project-scoped AND the request body contains
 *     `project.connect.id` (so we can answer access without a DB lookup)
 *
 * Anything that doesn't match falls through to ZenStack's regular handler
 * unchanged.
 */

import { NextResponse } from "next/server";
import {
  getAccessManifest,
  hasWriteAccess,
  type AccessManifest,
} from "./access-manifest";
import { prisma } from "./prisma";

/**
 * Models whose access is entirely determined by a direct `project` relation.
 * Listed models support the fast-create path when the request body provides
 * `project: { connect: { id } }`.
 */
const FAST_CREATE_MODELS = new Set([
  "repositoryCases",
  "repositoryFolders",
  "repositories",
  "testRuns",
  "sessions",
  "milestones",
  "comments",
]);

interface ParsedPath {
  model: string;
  operation: string;
}

/**
 * Attempt the fast path for the given request. Returns a `Response`
 * when the fast path handled the request, or `null` to indicate the
 * caller should continue with the regular ZenStack handler.
 */
export async function tryFastPathCreate(params: {
  parsedPath: ParsedPath | null;
  requestBody: unknown;
  userId: string | null;
}): Promise<NextResponse | null> {
  const { parsedPath, requestBody, userId } = params;

  if (!userId || !parsedPath) return null;
  if (parsedPath.operation !== "create") return null;
  if (!FAST_CREATE_MODELS.has(parsedPath.model)) return null;

  // Extract projectId from the request body.
  const projectId = extractProjectId(requestBody);
  if (projectId == null) return null;

  const manifest = await getAccessManifest(userId);
  if (!manifest) {
    // User not resolvable — defer to ZenStack so we get consistent auth errors.
    return null;
  }

  if (!hasWriteAccess(manifest, projectId)) {
    // Explicit deny. ZenStack's 403 formatting is preserved by the regular
    // path; rather than reproducing it, return 403 here. Nginx ingress maps
    // 403 → 422 (see route.ts remapping) so we go straight to that.
    return NextResponse.json(
      {
        error: {
          message: "access denied",
          code: "DENIED_BY_POLICY",
        },
      },
      { status: 422 }
    );
  }

  // At this point we know the user is allowed to create on this project.
  // Execute the create with raw Prisma (no enhance() wrapper — skips all
  // policy evaluation) and return the response in ZenStack's RPC format.
  const data = extractCreateData(requestBody);
  if (!data) return null;

  try {
    const modelAccessor = getPrismaModel(parsedPath.model);
    if (!modelAccessor) return null;

    const result = await modelAccessor.create({ data });
    return NextResponse.json(
      { data: result },
      { status: 201 }
    );
  } catch (err: unknown) {
    // Mirror ZenStack's error shape so clients see the same behaviour.
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      {
        error: {
          message,
          prisma: true,
        },
      },
      { status: 400 }
    );
  }
}

/**
 * Invalidate the manifest for the given user. Thin re-export so callers
 * of the fast path don't need to import access-manifest directly.
 */
export { invalidateAccessManifest } from "./access-manifest";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractProjectId(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;

  // Common shape: `{ project: { connect: { id: N } } }`
  const project = (data as { project?: unknown }).project;
  if (
    project &&
    typeof project === "object" &&
    "connect" in project
  ) {
    const connect = (project as { connect?: unknown }).connect;
    if (connect && typeof connect === "object" && "id" in connect) {
      const id = (connect as { id?: unknown }).id;
      if (typeof id === "number") return id;
    }
  }

  // Less common: `{ projectId: N }` (scalar FK)
  const scalarId = (data as { projectId?: unknown }).projectId;
  if (typeof scalarId === "number") return scalarId;

  return null;
}

function extractCreateData(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

/**
 * Map the model name from the URL (camelCase) to the Prisma client accessor.
 * Returns `null` if the model isn't recognised so the caller can fall back
 * to ZenStack.
 */
function getPrismaModel(
  modelName: string
): { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as unknown as Record<string, any>;
  const model = p[modelName];
  if (
    model &&
    typeof model === "object" &&
    typeof model.create === "function"
  ) {
    return model as {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
  }
  return null;
}

// Re-export AccessManifest type so callers can reason about it.
export type { AccessManifest };
