import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import {
  effectiveRequirementTypeIds,
  matchesRequirementDesignation,
  readRequirementTypeConfig,
  resolveEffectiveRequirementFlag,
} from "~/lib/integrations/requirementTypeConfig";
import { authOptions } from "~/server/auth";

// `override` is required and explicitly nullable — null means "reset to
// the configured classification", and its absence is a client bug, not a
// reset. `.nullable()`, never `.optional()`: optional rejects an explicit
// null (the recorded zod trap).
const bodySchema = z
  .object({
    override: z.enum(["FORCE_ON", "FORCE_OFF"]).nullable(),
  })
  .strict();

/**
 * POST /api/projects/[projectId]/requirements/[issueId]/override
 *
 * Sets the per-issue tri-state classification override on a SYNCED issue
 * and applies its effect to `isRequirement` in the same write: FORCE_ON
 * promotes one issue into the requirements tree outside the type config
 * (a Story in an Epics-only project — the PractiTest-precedent shape),
 * FORCE_OFF excludes one config-classified issue, and null re-resolves
 * the row from the current config. The recompute and both sync write
 * paths honor the override afterwards (`resolveEffectiveRequirementFlag`
 * is the shared rule), so the pinned state survives config saves and
 * polls in both directions.
 *
 * Deliberately NOT scoped with REQUIREMENT_SCOPE_WHERE: the promotion
 * direction addresses a row that is not a requirement yet. This route's
 * whole purpose is moving one row across the requirement/defect line, so
 * its read sits in the role-aware bucket of the HYG-01 containment gate.
 *
 * Synced issues only (400 otherwise): a native requirement's
 * classification is authorial — it was created AS a requirement and the
 * recompute never touches it — so an override has nothing to pin there.
 *
 * The write goes through the enhanced client: `requirementOverride` and
 * `isRequirement` carry no field-level deny (the five LOCKED_ISSUE_FIELDS
 * do not include them), and the ORM-level mutation is what lets the
 * ES-sync plugin and CDC audit capture fire without hand-rolled calls.
 *
 * Gate order, fixed (detach route convention): 401 -> 400 (bad ids) ->
 * 400 (bad body) -> 403 (authorizeProjectAdminForProject) -> 404 (no such
 * live issue in this project) -> 400 (not synced) -> operate.
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; issueId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam, issueId: issueIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      const issueId = parseInt(issueIdParam);
      if (isNaN(projectId) || isNaN(issueId)) {
        return NextResponse.json(
          { error: "Invalid project or issue ID" },
          { status: 400 }
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }
      const parsedBody = bodySchema.safeParse(parsedJson);
      if (!parsedBody.success) {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }
      const override = parsedBody.data.override;

      // Classification is a project-admin act, exactly like the type
      // config it overrides (and like detach). Issue's model policy has
      // no project scoping at all -- this is the only project boundary.
      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      const existing = await baseDb.issue.findFirst({
        where: {
          id: issueId,
          projectId,
          isDeleted: false,
        },
        select: {
          id: true,
          integrationId: true,
          issueTypeId: true,
          data: true,
          isRequirement: true,
          requirementOverride: true,
        },
      });
      if (!existing) {
        return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      }

      if (existing.integrationId == null) {
        return NextResponse.json(
          { error: "This issue is not synced with an issue tracker." },
          { status: 400 }
        );
      }

      // Resolve what the config alone says about this row, so the null
      // arm (and the response) reflect the live config rather than the
      // possibly-stale stored flag. Same predicate as
      // `resolveSyncedRequirementFlag`: the ACTIVE integration mapping
      // for this project.
      const mapping = await baseDb.projectIntegration.findFirst({
        where: {
          projectId,
          integrationId: existing.integrationId,
          isActive: true,
        },
        select: { config: true },
      });
      const rawLabels =
        existing.data &&
        typeof existing.data === "object" &&
        !Array.isArray(existing.data)
          ? (existing.data as Record<string, unknown>).labels
          : null;
      const labels = Array.isArray(rawLabels)
        ? rawLabels.filter(
            (label): label is string => typeof label === "string"
          )
        : [];
      const configMatch = matchesRequirementDesignation(
        effectiveRequirementTypeIds(
          readRequirementTypeConfig(mapping?.config ?? null)
        ),
        { issueTypeId: existing.issueTypeId, labels }
      );
      const nextIsRequirement = resolveEffectiveRequirementFlag(
        override,
        configMatch
      );

      if (
        existing.requirementOverride === override &&
        existing.isRequirement === nextIsRequirement
      ) {
        // Idempotent no-op -- nothing would change, so no write and no
        // audit frame.
        return NextResponse.json({
          success: true,
          requirementOverride: override,
          isRequirement: nextIsRequirement,
        });
      }

      const db = await getEnhancedDb(session);
      const updated = await db.issue.update({
        where: { id: issueId },
        data: {
          requirementOverride: override,
          isRequirement: nextIsRequirement,
        },
        select: { requirementOverride: true, isRequirement: true },
      });

      return NextResponse.json({
        success: true,
        requirementOverride: updated.requirementOverride,
        isRequirement: updated.isRequirement,
      });
    } catch (error) {
      console.error("Error setting requirement override:", error);
      return NextResponse.json(
        { error: "Failed to set requirement override" },
        { status: 500 }
      );
    }
  }
);
