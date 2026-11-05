import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { authOptions } from "~/server/auth";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { rawDb } from "~/lib/rawDb";
import {
  isProjectAdminFor,
  userHasAreaPermission,
} from "~/lib/services/areaPermission";
import {
  dismissPair,
  dismissPairs,
  linkCases,
  linkPairs,
  mergeCases,
} from "~/lib/services/mergeService";

/** Upper bound on pairs per bulk request (the server chunks internally). */
const MAX_BULK_PAIRS = 50_000;

const pairSchema = z.object({
  caseAId: z.number().int().positive(),
  caseBId: z.number().int().positive(),
});

const resolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    survivorId: z.number().int().positive(),
    victimId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("link"),
    caseAId: z.number().int().positive(),
    caseBId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("dismiss"),
    caseAId: z.number().int().positive(),
    caseBId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("bulkLink"),
    pairs: z.array(pairSchema).min(1).max(MAX_BULK_PAIRS),
    projectId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("bulkDismiss"),
    pairs: z.array(pairSchema).min(1).max(MAX_BULK_PAIRS),
    projectId: z.number().int().positive(),
  }),
]);

/**
 * Same gate as the DuplicateScanResult update policy: project admin, or
 * TestCaseRepository add/edit. The service layer writes through rawDb, so this
 * is the only permission check on this route.
 */
async function canResolve(userId: string, projectId: number) {
  return (
    (await isProjectAdminFor(userId, projectId)) ||
    (await userHasAreaPermission(
      userId,
      projectId,
      "TestCaseRepository",
      "canAddEdit"
    ))
  );
}

export const POST = withAuditContext(async (request: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = resolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    if (!(await canResolve(session.user.id, data.projectId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    switch (data.action) {
      case "merge": {
        // mergeCases takes bare case ids; make sure both live in the project
        // the caller was authorized against.
        const inProject = await rawDb.repositoryCases.count({
          where: {
            id: { in: [data.survivorId, data.victimId] },
            projectId: data.projectId,
          },
        });
        if (inProject !== 2) {
          return NextResponse.json(
            { error: "Cases not found in project" },
            { status: 404 }
          );
        }
        const result = await mergeCases(
          data.survivorId,
          data.victimId,
          session.user.id
        );
        // Audit the duplicate-scan resolution DECISION (D-12). The per-case
        // repositoryCases writes are already audited via the extension hook;
        // this row captures the high-level resolution intent so reviewers can
        // reconstruct why the underlying rows changed.
        await captureAuditEvent({
          action: "DUPLICATE_RESOLVED",
          entityType: "DuplicateScanResult",
          entityId: `${data.survivorId}:${data.victimId}`,
          projectId: data.projectId,
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          metadata: {
            resolution: "merge",
            survivorId: data.survivorId,
            victimId: data.victimId,
            targetCaseIds: [data.survivorId, data.victimId],
          },
        });
        return NextResponse.json({ action: "merge", ...result });
      }
      case "link": {
        const result = await linkCases(
          data.caseAId,
          data.caseBId,
          session.user.id,
          data.projectId
        );
        // Audit the duplicate-scan resolution DECISION (D-12). See merge branch.
        await captureAuditEvent({
          action: "DUPLICATE_RESOLVED",
          entityType: "DuplicateScanResult",
          entityId: `${data.caseAId}:${data.caseBId}`,
          projectId: data.projectId,
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          metadata: {
            resolution: "link",
            caseAId: data.caseAId,
            caseBId: data.caseBId,
            targetCaseIds: [data.caseAId, data.caseBId],
          },
        });
        return NextResponse.json({ action: "link", ...result });
      }
      case "dismiss": {
        const result = await dismissPair(
          data.caseAId,
          data.caseBId,
          data.projectId
        );
        // Audit the duplicate-scan resolution DECISION (D-12). "dismiss" is
        // the ignore-this-pair path -- no downstream case writes happen, so
        // this audit row is the only forensic trail for the decision.
        await captureAuditEvent({
          action: "DUPLICATE_RESOLVED",
          entityType: "DuplicateScanResult",
          entityId: `${data.caseAId}:${data.caseBId}`,
          projectId: data.projectId,
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          metadata: {
            resolution: "dismiss",
            caseAId: data.caseAId,
            caseBId: data.caseBId,
            targetCaseIds: [data.caseAId, data.caseBId],
          },
        });
        return NextResponse.json({ action: "dismiss", ...result });
      }
      case "bulkLink":
      case "bulkDismiss": {
        const resolution = data.action === "bulkLink" ? "link" : "dismiss";
        const result =
          data.action === "bulkLink"
            ? await linkPairs(data.pairs, session.user.id, data.projectId)
            : await dismissPairs(data.pairs, data.projectId);
        // One audit row for the whole bulk decision rather than one per pair.
        await captureAuditEvent({
          action: "DUPLICATE_RESOLVED",
          entityType: "DuplicateScanResult",
          entityId: `bulk:${data.pairs.length}`,
          projectId: data.projectId,
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          metadata: {
            resolution,
            bulk: true,
            pairCount: data.pairs.length,
            pairs: data.pairs,
          },
        });
        return NextResponse.json({ action: data.action, ...result });
      }
    }
  } catch (error) {
    console.error("Duplicate scan resolve error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
