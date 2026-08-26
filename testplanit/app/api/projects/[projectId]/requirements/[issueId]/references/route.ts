import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";
import { ApplicationArea } from "~/zenstack/models";
import { z } from "zod/v4";

// The external-pick shape a manual traceability reference can carry —
// mirrors the ExternalIssue fields components/issues/search-issues-dialog.tsx
// already produces (27-PATTERNS.md), so the fork this route eventually backs
// can post the exact object the picker already builds without reshaping it.
const externalPickSchema = z.object({
  externalId: z.string().min(1),
  key: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  externalUrl: z.string().optional(),
});

// Exactly one of internalIssueId / external must be present — a body naming
// both or neither is a 400 (LOCKED_ISSUE_FIELDS gate order, D-09/D-10).
const referencesBodySchema = z
  .object({
    internalIssueId: z.number().int().positive().optional(),
    external: externalPickSchema.optional(),
  })
  .refine((data) => Boolean(data.internalIssueId) !== Boolean(data.external), {
    message:
      "Provide exactly one of internalIssueId or external, not both or neither",
  });

/**
 * POST /api/projects/[projectId]/requirements/[issueId]/references
 *
 * LINK-03 (D-09/D-10/D-11): attach a manual traceability reference to a
 * requirement, either an internal pick (an existing Issue row) or an
 * external pick (upserted through the ONE reviewed guarded shell path,
 * upsertLinkedIssueShell). Neither branch's shell payload may carry the
 * requirement-tree discriminator or the hierarchy parent pointer — a
 * reference-created shell must never enter the requirements tree (D-09's
 * load-bearing companion rule).
 *
 * Gate order, fixed: 401 (no session) -> 400 (id parsing, body validation,
 * self-reference) -> 403 (resolveViewerProjectScope excludes projectId, or
 * excludes the referenced internal issue's own project) -> 404 (identity
 * pre-check) -> 403 (write permission) -> 400 (self-external-pick) ->
 * 200/500. Deliberately NOT gated on the requirement-lock predicate (D-11):
 * references are TestPlanIt-side annotations like Issue.note and must work
 * on a synced, locked requirement.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, issueId: issueIdParam } = await params;
    const projectId = Number(projectIdParam);
    const issueId = Number(issueIdParam);
    if (!Number.isInteger(projectId) || !Number.isInteger(issueId)) {
      return NextResponse.json(
        { error: "Invalid project or issue ID" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        {
          status: 400,
        }
      );
    }

    const parsed = referencesBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const validatedData = parsed.data;

    // Self-reference is a 400 before any DB write — never delegate this to
    // the model's own @@deny('create', requirementId == referencedIssueId),
    // which only fires for the internal branch once the referencedIssueId
    // is already known to equal issueId.
    if (
      validatedData.internalIssueId !== undefined &&
      validatedData.internalIssueId === issueId
    ) {
      return NextResponse.json(
        { error: "A requirement cannot reference itself" },
        { status: 400 }
      );
    }

    // The same resolved scope gates the requirement's project below and,
    // for an internal pick, the referenced issue's own project further
    // down — one value, two uses, so the two gates can never disagree.
    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Issue's model policy has no project scoping at all, so this pre-check
    // — bound to projectId, isDeleted: false, and spread with
    // REQUIREMENT_SCOPE_WHERE — is the only thing stopping a crafted
    // issueId from aiming this route at a defect row or another project's
    // requirement.
    const existing = await baseDb.issue.findFirst({
      where: {
        id: issueId,
        projectId,
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 }
      );
    }

    // Write authorization runs before either branch and before any side
    // effect -- baseDb carries no policy plugin, so the enhanced-client join
    // create below is the FINAL enforcement, not the first. The model
    // policy's own 'create' allow (schema.zmodel:1708-1728) is this same
    // TestCaseRepository/canAddEdit ladder PLUS the project creator, so the
    // creator clause below is required: omitting it would make this
    // pre-gate narrower than the policy it fronts and 403 a caller the
    // policy allows. The pre-gate being slightly broader than the policy
    // (the ladder also grants PROJECTADMIN project-wide) is intentional and
    // safe -- the enhanced-client create is still the final enforcement.
    const mayEdit = await userHasAreaPermission(
      session.user.id,
      projectId,
      ApplicationArea.TestCaseRepository,
      "canAddEdit"
    );
    if (!mayEdit) {
      const project = await baseDb.projects.findUnique({
        where: { id: projectId },
        select: { createdBy: true },
      });
      if (project?.createdBy !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    let referencedIssueId: number;

    if (validatedData.internalIssueId !== undefined) {
      // Internal pick: the row already exists — verify it and re-derive its
      // OWN projectId, closing the read-side residual a viewer could
      // otherwise use to pull an inaccessible project's issue title into a
      // requirement they can read (T-27-07-02).
      const target = await baseDb.issue.findFirst({
        where: { id: validatedData.internalIssueId, isDeleted: false },
        select: { id: true, projectId: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Referenced issue not found" },
          { status: 404 }
        );
      }
      if (
        scope !== null &&
        (target.projectId === null || !scope.includes(target.projectId))
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      referencedIssueId = target.id;
    } else {
      // External pick: resolve the project's active integration
      // server-side — never trust a client-supplied integrationId
      // (T-27-07-06) — then upsert the shell through the ONE reviewed
      // guarded path. Neither the create nor the update payload may carry
      // the requirement-tree discriminator or the hierarchy parent pointer
      // (D-09/T-27-07-04).
      const external = validatedData.external!;
      const activeIntegration = await baseDb.projectIntegration.findFirst({
        where: { projectId, isActive: true },
        select: { integrationId: true },
      });
      if (!activeIntegration) {
        return NextResponse.json(
          { error: "No active integration configured for this project" },
          { status: 400 }
        );
      }

      // Self-external-pick guard: resolve the dedup target BEFORE the
      // upsert runs, so a client-supplied externalId that happens to match
      // the requirement's own shell 400s with zero mutation, instead of the
      // shell update landing first and only THEN tripping the model's
      // @@deny('create', requirementId == referencedIssueId) as a 500 with
      // the mutation already persisted (this is an identity lookup on the
      // dedup key -- the file is already in
      // issueRoleScope.containment.test.ts's EXEMPT_REQUIREMENT_SCOPED_FILES).
      const dedupTarget = await baseDb.issue.findFirst({
        where: {
          externalId: external.externalId,
          integrationId: activeIntegration.integrationId,
        },
        select: { id: true },
      });
      if (dedupTarget?.id === issueId) {
        return NextResponse.json(
          { error: "A requirement cannot reference itself" },
          { status: 400 }
        );
      }

      const trackerFields = {
        name: external.key || external.externalId,
        title: external.title ?? external.key ?? external.externalId,
        description: external.description ?? "",
        status: external.status,
        priority: external.priority,
        externalId: external.externalId,
        externalKey: external.key,
        externalUrl: external.externalUrl,
        externalStatus: external.status,
      };

      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: external.externalId,
        integrationId: activeIntegration.integrationId,
        create: {
          ...trackerFields,
          projectId,
          createdById: session.user.id,
          integrationId: activeIntegration.integrationId,
        },
        update: {
          ...trackerFields,
        },
      });
      referencedIssueId = issue.id;
    }

    // Join write on the ENHANCED client — its own ZenStack policy (the
    // canAddEdit mirror, the self-reference @@deny, the unique-pair
    // constraint) is the FINAL policy enforcement behind the explicit
    // write-permission pre-gate above, not the first and only decision
    // (T-27-07-01).
    try {
      const enhancedDb = await getEnhancedDb(session);
      const created = await enhancedDb.requirementIssueReference.create({
        data: {
          requirementId: issueId,
          referencedIssueId,
          createdById: session.user.id,
        },
      });
      return NextResponse.json(
        { created: true, reference: created },
        { status: 200 }
      );
    } catch (createError) {
      // A repeat POST for an existing pair hits the composite PK — return
      // 200 created:false rather than a 500 (T-27-07-07), never a second
      // row.
      if (isUniqueConstraintError(createError)) {
        return NextResponse.json({ created: false }, { status: 200 });
      }
      throw createError;
    }
  } catch (error) {
    console.error("Requirement reference create error:", error);
    return NextResponse.json(
      { error: "Failed to attach reference" },
      { status: 500 }
    );
  }
}
