/**
 * mergeService.ts
 *
 * Core resolution service for duplicate test case pairs.
 * Provides merge, link, and dismiss operations.
 *
 * IMPORTANT: Uses raw `prisma` from `~/lib/prismaBase` (not ZenStack enhanced) to avoid
 * the ZenStack v3 63-character PostgreSQL alias limit on deeply nested queries and to
 * keep policy-layer overhead out of the atomic merge transaction.
 *
 * FK reroute order follows the "Recommended Transaction Order" in 49-RESEARCH.md.
 */

import { LinkType } from "@prisma/client";
import { prisma } from "~/lib/prismaBase";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeResult {
  survivorId: number;
  summary: {
    /** TestRunCases rows transferred from victim to survivor */
    runsTransferred: number;
    /** Victim tags added to survivor */
    tagsAdded: number;
    /** Victim RepositoryCaseVersions re-parented to survivor */
    versionsReparented: number;
  };
}

// ---------------------------------------------------------------------------
// mergeCases
// ---------------------------------------------------------------------------

/**
 * Atomically reroutes all FK relations from victim to survivor in a single
 * prisma.$transaction(). See 49-RESEARCH.md FK Reroute Map for full details.
 *
 * After the transaction, syncs both cases to Elasticsearch (best-effort).
 */
export async function mergeCases(
  survivorId: number,
  victimId: number,
  userId: string
): Promise<MergeResult> {
  const result = await prisma.$transaction(async (tx) => {
    // -----------------------------------------------------------------------
    // Step 1: Find conflicting TestRunCases rows
    // (same testRunId on both survivor and victim)
    // -----------------------------------------------------------------------
    const survivorRuns = await tx.testRunCases.findMany({
      where: { repositoryCaseId: survivorId },
      select: { testRunId: true },
    });
    const conflictRunIds = survivorRuns.map((r: { testRunId: number }) => r.testRunId);

    // -----------------------------------------------------------------------
    // Step 2: Delete conflicting victim rows (keep survivor's existing result)
    // -----------------------------------------------------------------------
    if (conflictRunIds.length > 0) {
      await tx.testRunCases.deleteMany({
        where: {
          repositoryCaseId: victimId,
          testRunId: { in: conflictRunIds },
        },
      });
    }

    // -----------------------------------------------------------------------
    // Step 3: Reroute remaining non-conflicting TestRunCases to survivor
    // -----------------------------------------------------------------------
    const { count: runsTransferred } = await tx.testRunCases.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });

    // -----------------------------------------------------------------------
    // Step 4: Steps and field values stay with victim (soft-deleted).
    // The primary case keeps its own steps and custom fields as-is.
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Step 5: Reroute result field values (test run result data, not case fields)
    // -----------------------------------------------------------------------
    await tx.resultFieldValues.updateMany({
      where: { testCaseId: victimId },
      data: { testCaseId: survivorId },
    });
    await tx.attachments.updateMany({
      where: { testCaseId: victimId },
      data: { testCaseId: survivorId },
    });

    // -----------------------------------------------------------------------
    // Step 8: Renumber and re-parent victim RepositoryCaseVersions
    // @@unique([repositoryCaseId, version]) — must offset by survivor.currentVersion
    // -----------------------------------------------------------------------
    const survivorCase = await tx.repositoryCases.findUnique({
      where: { id: survivorId },
      select: { currentVersion: true },
    });
    const versionOffset = survivorCase!.currentVersion;

    const victimVersions = await tx.repositoryCaseVersions.findMany({
      where: { repositoryCaseId: victimId },
      orderBy: { version: "asc" },
      select: { id: true, version: true },
    });
    for (const v of victimVersions) {
      await tx.repositoryCaseVersions.update({
        where: { id: v.id },
        data: {
          repositoryCaseId: survivorId,
          version: versionOffset + v.version,
        },
      });
    }
    const versionsReparented = victimVersions.length;

    // Step 9: Update survivor.currentVersion
    const newCurrentVersion =
      victimVersions.length > 0
        ? versionOffset + victimVersions[victimVersions.length - 1].version
        : versionOffset;
    await tx.repositoryCases.update({
      where: { id: survivorId },
      data: { currentVersion: newCurrentVersion },
    });

    // -----------------------------------------------------------------------
    // Step 10: JUnit records
    // -----------------------------------------------------------------------
    await tx.jUnitTestResult.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });
    await tx.jUnitProperty.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });
    await tx.jUnitAttachment.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });
    await tx.jUnitTestStep.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });

    // -----------------------------------------------------------------------
    // Step 11: Comments
    // -----------------------------------------------------------------------
    await tx.comment.updateMany({
      where: { repositoryCaseId: victimId },
      data: { repositoryCaseId: survivorId },
    });

    // -----------------------------------------------------------------------
    // Step 12: Tags and Issues (M2M implicit — connect is idempotent)
    // Prisma silently ignores already-connected relations.
    // -----------------------------------------------------------------------
    const victimData = await tx.repositoryCases.findUnique({
      where: { id: victimId },
      include: {
        tags: { select: { id: true } },
        issues: { select: { id: true } },
      },
    });

    const tagsAdded = victimData?.tags?.length ?? 0;
    const issuesAdded = victimData?.issues?.length ?? 0;

    if (tagsAdded > 0) {
      await tx.repositoryCases.update({
        where: { id: survivorId },
        data: { tags: { connect: victimData!.tags } },
      });
    }
    if (issuesAdded > 0) {
      await tx.repositoryCases.update({
        where: { id: survivorId },
        data: { issues: { connect: victimData!.issues } },
      });
    }

    // -----------------------------------------------------------------------
    // Step 13: Reroute victim's RepositoryCaseLinks to survivor
    // Use createMany skipDuplicates to handle @@unique([caseAId, caseBId, type])
    // -----------------------------------------------------------------------
    const victimLinksFrom = await tx.repositoryCaseLink.findMany({
      where: { caseAId: victimId },
      select: { caseBId: true, type: true, createdById: true },
    });
    const victimLinksTo = await tx.repositoryCaseLink.findMany({
      where: { caseBId: victimId },
      select: { caseAId: true, type: true, createdById: true },
    });

    if (victimLinksFrom.length > 0) {
      await tx.repositoryCaseLink.createMany({
        data: victimLinksFrom.map(
          (link: { caseBId: number; type: LinkType; createdById: string }) => ({
            caseAId: survivorId,
            caseBId: link.caseBId,
            type: link.type,
            createdById: link.createdById,
          })
        ),
        skipDuplicates: true,
      });
    }
    if (victimLinksTo.length > 0) {
      await tx.repositoryCaseLink.createMany({
        data: victimLinksTo.map(
          (link: { caseAId: number; type: LinkType; createdById: string }) => ({
            caseAId: link.caseAId,
            caseBId: survivorId,
            type: link.type,
            createdById: link.createdById,
          })
        ),
        skipDuplicates: true,
      });
    }

    // -----------------------------------------------------------------------
    // Step 14: Create audit RepositoryCaseLink (SAME_TEST_DIFFERENT_SOURCE)
    // Records the merge relationship as a permanent audit trail.
    // -----------------------------------------------------------------------
    await tx.repositoryCaseLink.create({
      data: {
        caseAId: survivorId,
        caseBId: victimId,
        type: "SAME_TEST_DIFFERENT_SOURCE",
        createdById: userId,
      },
    });

    // -----------------------------------------------------------------------
    // Step 15: Update resolved pair DuplicateScanResult → MERGED
    // -----------------------------------------------------------------------
    await tx.duplicateScanResult.updateMany({
      where: {
        OR: [
          { caseAId: victimId, caseBId: survivorId },
          { caseAId: survivorId, caseBId: victimId },
        ],
      },
      data: { status: "MERGED" },
    });

    // -----------------------------------------------------------------------
    // Step 16: Update all other PENDING scan results referencing victim → MERGED
    // (prevents stale candidates from resurfacing after soft-delete)
    // -----------------------------------------------------------------------
    await tx.duplicateScanResult.updateMany({
      where: {
        OR: [{ caseAId: victimId }, { caseBId: victimId }],
        status: "PENDING",
      },
      data: { status: "MERGED" },
    });

    // -----------------------------------------------------------------------
    // Step 17: Soft-delete victim (isDeleted: true — preserves audit trail)
    // -----------------------------------------------------------------------
    await tx.repositoryCases.update({
      where: { id: victimId },
      data: { isDeleted: true },
    });

    return {
      survivorId,
      summary: {
        runsTransferred,
        tagsAdded,
        versionsReparented,
      },
    };
  });

  // -------------------------------------------------------------------------
  // Post-transaction: Elasticsearch sync (best-effort, non-blocking)
  // victimId is now isDeleted=true — sync handles re-indexing accordingly.
  // -------------------------------------------------------------------------
  syncRepositoryCaseToElasticsearch(survivorId).catch(console.error);
  syncRepositoryCaseToElasticsearch(victimId).catch(console.error);

  return result;
}

// ---------------------------------------------------------------------------
// linkCases
// ---------------------------------------------------------------------------

/**
 * Creates a RepositoryCaseLink(SAME_TEST_DIFFERENT_SOURCE) and updates the
 * DuplicateScanResult status to LINKED.
 *
 * Both operations run in a single transaction-style call. Uses a static
 * array form of prisma.$transaction for simplicity (no interactive tx needed).
 */
export async function linkCases(
  caseAId: number,
  caseBId: number,
  userId: string,
  _projectId: number
): Promise<{ linked: true }> {
  // Use upsert to handle cases where the link already exists (idempotent)
  await prisma.$transaction([
    prisma.repositoryCaseLink.upsert({
      where: {
        caseAId_caseBId_type: {
          caseAId,
          caseBId,
          type: "SAME_TEST_DIFFERENT_SOURCE",
        },
      },
      create: {
        caseAId,
        caseBId,
        type: "SAME_TEST_DIFFERENT_SOURCE",
        createdById: userId,
      },
      update: {}, // Already linked — no-op
    }),
    prisma.duplicateScanResult.updateMany({
      where: {
        OR: [
          { caseAId, caseBId },
          { caseAId: caseBId, caseBId: caseAId },
        ],
      },
      data: { status: "LINKED" },
    }),
  ]);

  return { linked: true };
}

// ---------------------------------------------------------------------------
// dismissPair
// ---------------------------------------------------------------------------

/**
 * Sets DuplicateScanResult status to DISMISSED for a case pair.
 * Dismissed pairs are excluded from the candidates list (filtered by status=PENDING).
 */
export async function dismissPair(
  caseAId: number,
  caseBId: number,
  projectId: number
): Promise<{ dismissed: true }> {
  await prisma.duplicateScanResult.updateMany({
    where: {
      OR: [
        { caseAId, caseBId },
        { caseAId: caseBId, caseBId: caseAId },
      ],
      projectId,
    },
    data: { status: "DISMISSED" },
  });

  return { dismissed: true };
}
