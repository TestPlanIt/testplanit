import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { resolveViewerProjectScope } from "~/lib/authContext";
import {
  executionScopeBodyShape,
  toExecutionScope,
} from "~/lib/services/executionScopeParam";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { captureRequirementTraceabilitySnapshot } from "~/lib/services/requirementTraceabilitySnapshot";
import { authOptions } from "~/server/auth";
import { ApplicationArea } from "~/zenstack/models";

/** Mirrors the report handler's `requirementIds` cap. */
const MAX_REQUIREMENT_SCOPE_IDS = 1000;

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    note: z.string().max(4000).nullish(),
    // Same semantics as the reports' scope param: absent/null/empty = the
    // whole project. `.nullish()` — never `.optional()` — because an
    // explicit null is a legitimate "no scope".
    requirementIds: z
      .array(z.number().int().positive())
      .max(MAX_REQUIREMENT_SCOPE_IDS)
      .nullish(),
    // Execution scope (milestone/configuration) the capture counts under —
    // frozen onto the record. An id that matches no run simply contributes
    // no executions (scope only ever narrows), same forgiveness as
    // requirementIds above.
    ...executionScopeBodyShape,
  })
  .strict();

/**
 * POST /api/projects/[projectId]/requirements/snapshots
 *
 * Captures a requirement traceability snapshot: the live matrix (whole
 * project, or the selected requirements' subtrees) persisted as an
 * immutable, named, point-in-time record. Listing, renaming, and
 * soft-deleting snapshots go through the ZenStack model hooks — only the
 * capture needs a route, because it composes the coverage loader and
 * writes the header plus every entry in one transaction.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-numeric project id) ->
 * 400 (bad body) -> 403 (viewer's project scope excludes the project) ->
 * 403 (no Reporting add/edit on the project — the same ladder the
 * snapshot model's create policy encodes) -> 201. The resolved viewer
 * scope is ALSO what the capture reads coverage under, so the record
 * holds exactly what its capturer could see — one value, two uses.
 * Deliberately not gated on `Projects.requirementsEnabled`: a
 * presentation opt-in, not an access boundary (the traceability route's
 * own convention).
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam } = await params;
      const projectId = Number(projectIdParam);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return NextResponse.json(
          { error: "Invalid project ID" },
          { status: 400 }
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(parsedJson);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }

      const scope = await resolveViewerProjectScope(session.user.id);
      if (scope !== null && !scope.includes(projectId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const canCapture = await userHasAreaPermission(
        session.user.id,
        projectId,
        ApplicationArea.Reporting,
        "canAddEdit"
      );
      if (!canCapture) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const rootIds =
        parsed.data.requirementIds && parsed.data.requirementIds.length > 0
          ? parsed.data.requirementIds
          : undefined;

      const snapshot = await captureRequirementTraceabilitySnapshot(
        {
          projectId,
          name: parsed.data.name,
          note: parsed.data.note ?? null,
          rootIds,
          executionScope: toExecutionScope(parsed.data),
          capturedById: session.user.id,
        },
        { accessibleProjectIds: scope }
      );

      return NextResponse.json(snapshot, { status: 201 });
    } catch (error) {
      console.error("Requirement traceability snapshot capture error:", error);
      return NextResponse.json(
        { error: "Failed to capture requirement traceability snapshot" },
        { status: 500 }
      );
    }
  }
);
