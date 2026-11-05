/**
 * mergeService.ts
 *
 * Core resolution service for duplicate test case pairs.
 * Provides merge, link, and dismiss operations.
 *
 * IMPORTANT: Uses raw `rawDb` from `~/lib/rawDb` (not ZenStack enhanced) to avoid
 * the ZenStack v3 63-character PostgreSQL alias limit on deeply nested queries and to
 * keep policy-layer overhead out of the atomic merge transaction.
 *
 * FK reroute order follows the "Recommended Transaction Order" in 49-RESEARCH.md.
 */

import { LinkType } from "~/zenstack/models";
import { rawDb } from "~/lib/rawDb";
import { withAuditGuc, buildGucPayload } from "~/lib/audit/gucContext";
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
 * rawDb.$transaction(). See 49-RESEARCH.md FK Reroute Map for full details.
 *
 * After the transaction, syncs both cases to Elasticsearch (best-effort).
 */
export async function mergeCases(
  survivorId: number,
  victimId: number,
  userId: string
): Promise<MergeResult> {
  const result = await withAuditGuc(
    rawDb,
    buildGucPayload(userId),
    async (tx) => {
      // -----------------------------------------------------------------------
      // Step 1: Find conflicting TestRunCases rows
      // (same testRunId on both survivor and victim)
      // -----------------------------------------------------------------------
      const survivorRuns = await tx.testRunCases.findMany({
        where: { repositoryCaseId: survivorId, isDeleted: false },
        select: { testRunId: true },
      });
      const conflictRunIds = survivorRuns.map(
        (r: { testRunId: number }) => r.testRunId
      );

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
      // Step 12: Tags and Issues (explicit M2M join — createMany skipDuplicates
      // is idempotent; already-linked rows are silently skipped).
      // -----------------------------------------------------------------------
      const victimData = await tx.repositoryCases.findUnique({
        where: { id: victimId },
        include: {
          caseTags: { select: { tagId: true } },
          caseIssues: { select: { issueId: true } },
        },
      });

      const victimTags = victimData?.caseTags ?? [];
      const victimIssues = victimData?.caseIssues ?? [];
      const tagsAdded = victimTags.length;
      const issuesAdded = victimIssues.length;

      if (tagsAdded > 0) {
        await tx.repositoryCaseTag.createMany({
          data: victimTags.map((ct: { tagId: number }) => ({
            caseId: survivorId,
            tagId: ct.tagId,
          })),
          skipDuplicates: true,
        });
      }
      if (issuesAdded > 0) {
        await tx.repositoryCaseIssue.createMany({
          data: victimIssues.map((ci: { issueId: number }) => ({
            caseId: survivorId,
            issueId: ci.issueId,
          })),
          skipDuplicates: true,
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

      // A link between the two merging cases would become a self-link on the
      // survivor, which the link guard rejects; drop those.
      const linksFromOthers = victimLinksFrom.filter(
        (link: { caseBId: number }) => link.caseBId !== survivorId
      );
      const linksToOthers = victimLinksTo.filter(
        (link: { caseAId: number }) => link.caseAId !== survivorId
      );

      if (linksFromOthers.length > 0) {
        await tx.repositoryCaseLink.createMany({
          data: linksFromOthers.map(
            (link: {
              caseBId: number;
              type: LinkType;
              createdById: string;
            }) => ({
              caseAId: survivorId,
              caseBId: link.caseBId,
              type: link.type,
              createdById: link.createdById,
            })
          ),
          skipDuplicates: true,
        });
      }
      if (linksToOthers.length > 0) {
        await tx.repositoryCaseLink.createMany({
          data: linksToOthers.map(
            (link: {
              caseAId: number;
              type: LinkType;
              createdById: string;
            }) => ({
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
    }
  );

  // -------------------------------------------------------------------------
  // Post-transaction: Elasticsearch sync (best-effort, non-blocking)
  // victimId is now isDeleted=true — sync handles re-indexing accordingly.
  // -------------------------------------------------------------------------
  syncRepositoryCaseToElasticsearch(survivorId).catch(console.error);
  syncRepositoryCaseToElasticsearch(victimId).catch(console.error);

  return result;
}

// ---------------------------------------------------------------------------
// Pair resolution (link / dismiss), single and bulk
// ---------------------------------------------------------------------------

export interface CasePair {
  caseAId: number;
  caseBId: number;
}

/**
 * Pairs per statement. Each pair becomes two OR branches (both orientations),
 * so 500 pairs = 1,000 branches, well inside Postgres' comfort zone and the
 * bind-parameter limit.
 */
export const PAIR_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Drops exact and reversed duplicates so each pair is touched once. */
function uniquePairs(pairs: CasePair[]): CasePair[] {
  const seen = new Set<string>();
  const out: CasePair[] = [];
  for (const p of pairs) {
    const key =
      p.caseAId < p.caseBId
        ? `${p.caseAId}:${p.caseBId}`
        : `${p.caseBId}:${p.caseAId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Matches a pair's scan-result rows in either orientation. */
function pairOrClause(pairs: CasePair[]) {
  return pairs.flatMap(({ caseAId, caseBId }) => [
    { caseAId, caseBId },
    { caseAId: caseBId, caseBId: caseAId },
  ]);
}

/**
 * Creates RepositoryCaseLink(SAME_TEST_DIFFERENT_SOURCE) rows and marks the
 * matching DuplicateScanResult rows LINKED.
 *
 * Only pairs that have a scan result in `projectId` are acted on, so a caller
 * can't link arbitrary cases (or cases in another project) through this path.
 * Each chunk runs as one transaction: createMany(skipDuplicates) + updateMany.
 */
export async function linkPairs(
  pairs: CasePair[],
  userId: string,
  projectId: number
): Promise<{ linked: number }> {
  let linked = 0;

  for (const batch of chunk(uniquePairs(pairs), PAIR_CHUNK_SIZE)) {
    const where = { projectId, OR: pairOrClause(batch) };

    const existing = await rawDb.duplicateScanResult.findMany({
      where,
      select: { caseAId: true, caseBId: true },
    });
    const known = new Set(
      existing.flatMap((r) => [
        `${r.caseAId}:${r.caseBId}`,
        `${r.caseBId}:${r.caseAId}`,
      ])
    );
    const valid = batch.filter((p) => known.has(`${p.caseAId}:${p.caseBId}`));
    if (valid.length === 0) continue;

    await rawDb.$transaction([
      rawDb.repositoryCaseLink.createMany({
        data: valid.map(({ caseAId, caseBId }) => ({
          caseAId,
          caseBId,
          type: LinkType.SAME_TEST_DIFFERENT_SOURCE,
          createdById: userId,
        })),
        skipDuplicates: true, // already linked — no-op
      }),
      rawDb.duplicateScanResult.updateMany({
        where: { projectId, OR: pairOrClause(valid) },
        data: { status: "LINKED" },
      }),
    ]);
    linked += valid.length;
  }

  return { linked };
}

/**
 * Sets DuplicateScanResult status to DISMISSED for every given pair in the
 * project. Dismissed pairs are excluded from the candidates list (filtered by
 * status=PENDING). One updateMany per chunk.
 */
export async function dismissPairs(
  pairs: CasePair[],
  projectId: number
): Promise<{ dismissed: number }> {
  let dismissed = 0;

  for (const batch of chunk(uniquePairs(pairs), PAIR_CHUNK_SIZE)) {
    const result = await rawDb.duplicateScanResult.updateMany({
      where: { projectId, OR: pairOrClause(batch) },
      data: { status: "DISMISSED" },
    });
    dismissed += result.count;
  }

  return { dismissed };
}

/** Single-pair link; see linkPairs. */
export async function linkCases(
  caseAId: number,
  caseBId: number,
  userId: string,
  projectId: number
): Promise<{ linked: true }> {
  await linkPairs([{ caseAId, caseBId }], userId, projectId);
  return { linked: true };
}

/** Single-pair dismiss; see dismissPairs. */
export async function dismissPair(
  caseAId: number,
  caseBId: number,
  projectId: number
): Promise<{ dismissed: true }> {
  await dismissPairs([{ caseAId, caseBId }], projectId);
  return { dismissed: true };
}
