import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import {
  diffRequirementTypeIds,
  effectiveRequirementTypeIds,
  mergeRequirementTypeConfig,
  readRequirementTypeConfig,
  sanitizeRequirementTypeIds,
  type RequirementTypeConfig,
} from "~/lib/integrations/requirementTypeConfig";
import { recomputeRequirementClassification } from "~/lib/services/requirementHierarchy";
import { authOptions } from "~/server/auth";

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Writes a project's requirements-config (CFG-01) and reconciles existing
 * issue classification (CFG-03) in ONE audited transaction.
 *
 * Why a new route instead of the generated `projectIntegration` update
 * hook: CLAUDE.md's standing rule prefers ZenStack's generated hooks over
 * new API endpoints, with an explicit carve-out for operations that span
 * multiple models or need a transaction — this is that carve-out. One
 * transaction must contain both a `ProjectIntegration.config` write AND a
 * bulk `Issue.isRequirement` update; the generated hook on
 * `ProjectIntegration` cannot enclose the second write, and splitting the
 * two calls into two requests reintroduces exactly the half-applied state
 * CFG-03 exists to prevent — a page refresh or a dropped connection
 * between the two calls would leave a saved config with no matching
 * reclassify, permanently. This config's flat `{ enabled, issueTypeIds,
 * issueTypeNames }` shape has no sub-field that skips the recompute, so
 * this route is the only save path for it.
 */
export const PUT = withAuditContext(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const integrationId = parseInt(id);
      if (isNaN(integrationId)) {
        return NextResponse.json(
          { error: "Invalid integration ID" },
          { status: 400 }
        );
      }

      let body: any;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json(
          { error: "Malformed JSON body" },
          { status: 400 }
        );
      }

      const projectId = body?.projectId;
      if (
        typeof projectId !== "number" ||
        !Number.isFinite(projectId) ||
        !Number.isInteger(projectId) ||
        projectId <= 0
      ) {
        return NextResponse.json(
          { error: "projectId must be a positive integer" },
          { status: 400 }
        );
      }

      if (typeof body?.enabled !== "boolean") {
        return NextResponse.json(
          { error: "enabled must be a boolean" },
          { status: 400 }
        );
      }

      const issueTypeIds = sanitizeRequirementTypeIds(body?.issueTypeIds);
      if (issueTypeIds === null) {
        return NextResponse.json(
          { error: "issueTypeIds must be an array of non-empty strings" },
          { status: 400 }
        );
      }

      const issueTypeNames = isPlainStringRecord(body?.issueTypeNames)
        ? body.issueTypeNames
        : undefined;

      // The ONLY access control on this write path: the transaction below
      // runs on `baseDb`, the raw non-policy client, so ZenStack's
      // `ProjectIntegration` `@@allow` ladder never evaluates here. Without
      // this explicit gate, any authenticated user could flip which issue
      // types classify as requirements for any project — a mass
      // data-visibility mutation (it decides which rows the requirement
      // lock protects and which rows requirement surfaces show), not a
      // cosmetic setting. Closes the same class of gap the milestone-sync
      // routes closed with their own admin gate.
      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      // Binds the caller's authorized projectId to the addressed
      // integrationId: a project admin for project A cannot aim this write
      // at an integration row owned by project B. The isActive predicate
      // matches 22-02's sync-side config reader, so both readers agree on
      // which ProjectIntegration row is authoritative.
      const row = await baseDb.projectIntegration.findFirst({
        where: { projectId, integrationId, isActive: true },
        select: { id: true, config: true },
      });
      if (!row) {
        return NextResponse.json(
          { error: "Integration not found for this project" },
          { status: 404 }
        );
      }

      const prevEffective = effectiveRequirementTypeIds(
        readRequirementTypeConfig(row.config)
      );
      const next: RequirementTypeConfig = {
        enabled: body.enabled,
        issueTypeIds,
        ...(issueTypeNames ? { issueTypeNames } : {}),
      };
      // effectiveRequirementTypeIds collapses a disabled config to an
      // empty set, so flipping the enable switch off de-classifies
      // everything the project had configured — the impact preview shows
      // the admin this before they commit to it.
      const nextEffective = effectiveRequirementTypeIds(next);
      const { added, removed } = diffRequirementTypeIds(
        prevEffective,
        nextEffective
      );

      const result = await auditedTransaction(async (tx) => {
        await tx.projectIntegration.update({
          where: { id: row.id },
          data: {
            config: mergeRequirementTypeConfig(row.config, next) as any,
          },
        });
        return recomputeRequirementClassification(projectId, added, removed, {
          tx,
          // Label-mode declassify correctness: a typeless (label-matched)
          // row that loses one configured label but still carries another
          // entry from this list must stay classified.
          nextEffectiveTypeIds: nextEffective,
        });
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error("Error saving requirements config:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
