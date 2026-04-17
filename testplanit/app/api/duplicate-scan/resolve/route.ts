import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "~/server/auth";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  dismissPair,
  linkCases,
  mergeCases,
} from "~/lib/services/mergeService";

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
]);

export async function POST(request: Request) {
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

    switch (data.action) {
      case "merge": {
        const result = await mergeCases(
          data.survivorId,
          data.victimId,
          session.user.id
        );
        // Audit the duplicate-scan resolution DECISION (D-12). The per-case
        // repositoryCases writes are already audited via the extension hook;
        // this row captures the high-level resolution intent so reviewers can
        // reconstruct why the underlying rows changed.
        captureAuditEvent({
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
        }).catch((error) => {
          console.error("Failed to audit duplicate-scan resolution:", error);
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
        captureAuditEvent({
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
        }).catch((error) => {
          console.error("Failed to audit duplicate-scan resolution:", error);
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
        captureAuditEvent({
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
        }).catch((error) => {
          console.error("Failed to audit duplicate-scan resolution:", error);
        });
        return NextResponse.json({ action: "dismiss", ...result });
      }
    }
  } catch (error) {
    console.error("Duplicate scan resolve error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
