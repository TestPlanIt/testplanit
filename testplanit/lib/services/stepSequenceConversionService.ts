// Uses prismaBase (raw client) — ZenStack v3 Kysely generates aliases that exceed
// PostgreSQL's 63-char limit for deeply nested conversion queries

import { prisma } from "~/lib/prismaBase";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { emptyEditorContent } from "~/app/constants/backend";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";
import { syncSharedStepToElasticsearch } from "~/services/sharedStepSearch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversionResult {
  sharedStepGroupId: number;
  convertedCaseIds: number[];
  skippedCaseIds: number[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// convertMatch
// ---------------------------------------------------------------------------

/**
 * Atomically converts a detected step-sequence cluster into a SharedStepGroup.
 *
 * Transaction steps (in order):
 * 1. Load match and validate
 * 2. Create version snapshots for all affected cases (BEFORE any step modification)
 * 3. Create one SharedStepGroup for the cluster
 * 4. Create SharedStepItems from the canonical case's matched steps
 * 5. For each affected case: soft-delete matched steps, insert placeholder, re-number surviving steps
 * 6. Update match status to CONVERTED
 *
 * Post-transaction: Elasticsearch sync (best-effort, fire-and-forget)
 */
export async function convertMatch(
  matchId: number,
  sharedStepGroupName: string,
  requestedCaseIds: number[],
  userId: string,
  editedSteps?: Array<{ step: string | null; expectedResult: string | null }>,
): Promise<ConversionResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      // -----------------------------------------------------------------------
      // Step 1 — Load match and validate
      // -----------------------------------------------------------------------
      const match = await tx.stepSequenceMatch.findUnique({
        where: { id: matchId },
        include: { members: true },
      });

      if (!match || match.isDeleted) {
        throw new Error(`StepSequenceMatch ${matchId} not found`);
      }

      if (match.status !== "PENDING") {
        throw new Error("Match already converted or dismissed");
      }

      // Filter to only cases whose caseId is in requestedCaseIds
      const affectedCases = (match.members as Array<{
        id: number;
        matchId: number;
        caseId: number;
        startStepId: number;
        endStepId: number;
        isDeleted: boolean;
      }>).filter((c) => requestedCaseIds.includes(c.caseId));

      if (affectedCases.length === 0) {
        throw new Error("No matching cases found for the requested case IDs");
      }

      // -----------------------------------------------------------------------
      // Step 2 — Create version snapshots BEFORE any step modification
      // -----------------------------------------------------------------------
      for (const affectedCase of affectedCases) {
        await tx.repositoryCases.update({
          where: { id: affectedCase.caseId },
          data: { currentVersion: { increment: 1 } },
        });
        await createTestCaseVersionInTransaction(tx, affectedCase.caseId, {
          creatorId: userId,
        });
      }

      // -----------------------------------------------------------------------
      // Step 3 — Create SharedStepGroup (ONE per cluster, not per case)
      // -----------------------------------------------------------------------
      const newGroup = await tx.sharedStepGroup.create({
        data: {
          name: sharedStepGroupName,
          projectId: match.projectId,
          createdById: userId,
        },
      });

      // -----------------------------------------------------------------------
      // Step 4 — Create SharedStepItems from the canonical case's matched steps
      // Use the first affected case as the canonical source
      // -----------------------------------------------------------------------
      const canonicalCase = affectedCases[0];
      const canonicalSteps = await tx.steps.findMany({
        where: {
          testCaseId: canonicalCase.caseId,
          id: { in: [canonicalCase.startStepId, canonicalCase.endStepId] },
          isDeleted: false,
        },
        orderBy: { order: "asc" },
      });

      // If editedSteps is a full replacement set (user added/deleted steps),
      // use it directly. Otherwise merge per-index with canonical steps.
      const isFullReplacement = editedSteps && editedSteps.every((s) => s.step !== null);

      if (isFullReplacement) {
        // User-defined step set — ignore canonical steps entirely
        for (let idx = 0; idx < editedSteps.length; idx++) {
          const edited = editedSteps[idx]!;
          await tx.sharedStepItem.create({
            data: {
              sharedStepGroupId: newGroup.id,
              step: (edited.step ?? emptyEditorContent) as any,
              expectedResult: (edited.expectedResult ?? emptyEditorContent) as any,
              order: idx,
            },
          });
        }
      } else if (canonicalSteps.length >= 1) {
        // Merge edits with canonical steps
        const startOrder = Math.min(...canonicalSteps.map((s: { order: number }) => s.order));
        const endOrder = Math.max(...canonicalSteps.map((s: { order: number }) => s.order));

        const canonicalMatchedSteps = canonicalSteps.length >= 2
          ? await tx.steps.findMany({
              where: {
                testCaseId: canonicalCase.caseId,
                order: { gte: startOrder, lte: endOrder },
                isDeleted: false,
              },
              orderBy: { order: "asc" },
            })
          : canonicalSteps;

        for (let idx = 0; idx < canonicalMatchedSteps.length; idx++) {
          const step = canonicalMatchedSteps[idx];
          const edited = editedSteps?.[idx];
          const stepContent = edited?.step ?? step.step ?? emptyEditorContent;
          const erContent = edited?.expectedResult ?? step.expectedResult ?? emptyEditorContent;
          await tx.sharedStepItem.create({
            data: {
              sharedStepGroupId: newGroup.id,
              step: stepContent as any,
              expectedResult: erContent as any,
              order: idx,
            },
          });
        }
      }

      // -----------------------------------------------------------------------
      // Step 5 — For each affected case, convert steps
      // -----------------------------------------------------------------------
      const convertedCaseIds: number[] = [];
      const skippedCaseIds: number[] = [];

      for (const affectedCase of affectedCases) {
        const { caseId, startStepId, endStepId } = affectedCase;

        // a. Validate step IDs still exist (skip case if they don't)
        const boundarySteps = await tx.steps.findMany({
          where: {
            testCaseId: caseId,
            id: { in: [startStepId, endStepId] },
            isDeleted: false,
          },
        });

        if (boundarySteps.length < 2) {
          // Steps have changed since scan — skip this case
          skippedCaseIds.push(caseId);
          continue;
        }

        // b. Determine matched step range (by order)
        const startOrder = Math.min(...boundarySteps.map((s: { order: number }) => s.order));
        const endOrder = Math.max(...boundarySteps.map((s: { order: number }) => s.order));

        const matchedSteps = await tx.steps.findMany({
          where: {
            testCaseId: caseId,
            order: { gte: startOrder, lte: endOrder },
            isDeleted: false,
          },
          orderBy: { order: "asc" },
        });

        const matchedStepIds = matchedSteps.map((s: { id: number }) => s.id);
        const matchLength = matchedSteps.length;

        // c. Soft-delete matched steps (NEVER hard-delete — preserves TestRunStepResults FK references)
        await tx.steps.updateMany({
          where: {
            testCaseId: caseId,
            id: { in: matchedStepIds },
            isDeleted: false,
          },
          data: { isDeleted: true },
        });

        // d. Insert placeholder step pointing to the SharedStepGroup
        await tx.steps.create({
          data: {
            testCaseId: caseId,
            order: startOrder,
            sharedStepGroupId: newGroup.id,
            step: emptyEditorContent,
            expectedResult: emptyEditorContent,
            isDeleted: false,
          },
        });

        // e. Re-number surviving steps above the deleted range
        // The placeholder occupies startOrder, so steps above endOrder need to shift down
        // by (matchLength - 1) to fill the gap
        await tx.steps.updateMany({
          where: {
            testCaseId: caseId,
            order: { gt: startOrder + matchLength - 1 },
            isDeleted: false,
          },
          data: { order: { decrement: matchLength - 1 } },
        });

        convertedCaseIds.push(caseId);
      }

      // -----------------------------------------------------------------------
      // Step 6 — Update match status to CONVERTED
      // -----------------------------------------------------------------------
      await tx.stepSequenceMatch.update({
        where: { id: matchId },
        data: { status: "CONVERTED" },
      });

      return {
        sharedStepGroupId: newGroup.id,
        convertedCaseIds,
        skippedCaseIds,
      };
    },
    { timeout: 30000 }
  );

  // -------------------------------------------------------------------------
  // Post-transaction: Elasticsearch sync (best-effort, non-blocking)
  // -------------------------------------------------------------------------
  for (const caseId of result.convertedCaseIds) {
    syncRepositoryCaseToElasticsearch(caseId).catch((err: unknown) =>
      console.error("ES sync failed for case", caseId, err)
    );
  }
  syncSharedStepToElasticsearch(result.sharedStepGroupId).catch((err: unknown) =>
    console.error("ES sync failed for group", result.sharedStepGroupId, err)
  );

  return result;
}
