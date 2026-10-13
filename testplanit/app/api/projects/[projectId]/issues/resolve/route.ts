import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authorizeProjectApiRequest } from "~/lib/api/authorizeProjectApiRequest";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
} from "~/lib/services/resolveIssueKeys";

/**
 * Resolve tracker issue keys to local `Issue` rows, creating any row that
 * doesn't exist here yet.
 *
 * This is the endpoint that removes the "open the ticket in the UI once" step
 * from every programmatic path: a script, an agent, or a migration can name
 * `PROJ-123` and get back the same `Issue` row a human would have produced by
 * searching for it in the web UI. Re-resolving a key it already materialized
 * is a plain lookup with no upstream traffic.
 *
 * Reachable by session or by an API token with write scope — creating rows is
 * a write, so a `mode:read` token is rejected the same way it is on
 * bulk-create.
 *
 * Per-key failures are reported in `results`, not raised: one unknown key in a
 * batch of thirty leaves the other twenty-nine resolved.
 */

const resolveSchema = z.object({
  keys: z.array(z.string().min(1).max(255)).min(1).max(100),
  // Optional — the project's single active issue-tracker integration is used
  // when it is unambiguous. Required when the project has more than one.
  integrationId: z.number().int().positive().optional(),
});

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid project ID" },
          { status: 400 }
        );
      }

      const auth = await authorizeProjectApiRequest(request, projectId);
      if (!auth.ok) {
        return NextResponse.json(auth.body, { status: auth.status });
      }

      const body = await request.json();
      const data = resolveSchema.parse(body);

      const resolved = await resolveIssueKeys({
        projectId,
        keys: data.keys,
        integrationId: data.integrationId,
      });

      // Preserve the caller's ordering, and echo duplicates back once each so
      // the response lines up index-for-index with the request.
      const results = data.keys.map(
        (key) => resolved.get(key) ?? { key, error: "Issue key is empty." }
      );
      const resolvedCount = results.filter((r) => r.issueId != null).length;

      return NextResponse.json({
        success: true,
        resolvedCount,
        failedCount: results.length - resolvedCount,
        createdCount: results.filter((r) => r.created).length,
        results,
      });
    } catch (error) {
      if (error instanceof IssueKeyResolutionError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }
      console.error("Error resolving issue keys:", error);
      return NextResponse.json(
        { error: "Failed to resolve issue keys" },
        { status: 500 }
      );
    }
  }
);
