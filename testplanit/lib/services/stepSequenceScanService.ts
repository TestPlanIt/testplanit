/**
 * StepSequenceScanService — shared step sequence detection engine.
 *
 * Finds groups of test cases that share contiguous step sequences using
 * fuzzy matching (levenshteinRatio >= 0.85 via stepsEqual).
 *
 * IMPORTANT: Caller MUST invoke resolveSharedSteps() on cases BEFORE passing
 * them to findSharedSequences(). Unresolved shared step placeholders contain
 * empty text and will produce false-positive sequence matches.
 *
 * Output is group-oriented (N cases per group), not pairwise — if cases A, B,
 * and C all share the same step sequence fingerprint, they appear as one group
 * with three members rather than three separate pairs.
 */

import { lcs, stepsEqual } from "~/lib/utils/similarity";
import { extractStepText } from "~/services/helpers/extractStepText";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StepSequenceGroup {
  /** Joined plain text of the matched steps — used for deduplication across pairs. */
  fingerprint: string;
  /** Number of steps in the shared sequence. */
  stepCount: number;
  /** Cases that contain this sequence, with the exact step ID range. */
  members: Array<{
    caseId: number;
    /** Steps.id of the first matched step in this case. */
    startStepId: number;
    /** Steps.id of the last matched step in this case. */
    endStepId: number;
  }>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CaseInput {
  id: number;
  steps: Array<{
    id: number;
    step: any; // TipTap JSON or plain string
    expectedResult: any; // TipTap JSON or plain string
    order: number;
  }>;
}

interface ExtractedStep {
  id: number;
  step: string; // plain text after extractStepText
  expectedResult: string; // plain text after extractStepText
  order: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StepSequenceScanService {
  /**
   * Find shared step sequences across cases.
   *
   * Runs pairwise LCS between all cases, extracts contiguous subsequences of
   * length >= minSteps, then groups cases by sequence fingerprint. A fingerprint
   * is the joined plain text of all steps in the sequence so that the same
   * logical sequence found in multiple pairs maps to a single group.
   *
   * IMPORTANT: Caller MUST run resolveSharedSteps() on cases BEFORE passing
   * them here to avoid false-positive matches from shared step placeholders.
   *
   * @param cases - Array of pre-resolved cases with their steps
   * @param minSteps - Minimum sequence length to report (default 3)
   * @returns Groups of cases sharing the same contiguous step sequence
   */
  findSharedSequences(cases: CaseInput[], minSteps = 3): StepSequenceGroup[] {
    if (cases.length < 2) return [];

    // 1. Extract plain text for all steps in all cases, sorted by order
    const extracted = new Map<number, ExtractedStep[]>();
    for (const c of cases) {
      const steps = [...c.steps]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          id: s.id,
          step: extractStepText(s.step),
          expectedResult: extractStepText(s.expectedResult),
          order: s.order,
        }));
      extracted.set(c.id, steps);
    }

    // 2. Pairwise LCS comparison — for each unique pair (i < j)
    const fingerprintToGroup = new Map<string, StepSequenceGroup>();
    const caseIds = Array.from(extracted.keys());

    for (let i = 0; i < caseIds.length; i++) {
      for (let j = i + 1; j < caseIds.length; j++) {
        const aId = caseIds[i]!;
        const bId = caseIds[j]!;
        const aSteps = extracted.get(aId)!;
        const bSteps = extracted.get(bId)!;

        // Run LCS with stepsEqual predicate (levenshteinRatio >= 0.85)
        const matchedPairs = lcs(aSteps, bSteps, (x, y) => stepsEqual(x, y));

        // Extract contiguous runs of consecutive index pairs
        const runs = extractContiguousRuns(matchedPairs, minSteps);

        for (const run of runs) {
          // Compute fingerprint from the step texts in the run (using a's steps)
          // The join separator \n---\n is unlikely to appear in step content
          const fingerprint = run
            .map((p) => {
              const s = aSteps[p.aIdx]!;
              return s.step + "\n" + s.expectedResult;
            })
            .join("\n---\n");

          const existing = fingerprintToGroup.get(fingerprint);
          if (existing) {
            // Add both cases if not already present
            if (!existing.members.some((m) => m.caseId === aId)) {
              existing.members.push({
                caseId: aId,
                startStepId: aSteps[run[0]!.aIdx]!.id,
                endStepId: aSteps[run[run.length - 1]!.aIdx]!.id,
              });
            }
            if (!existing.members.some((m) => m.caseId === bId)) {
              existing.members.push({
                caseId: bId,
                startStepId: bSteps[run[0]!.bIdx]!.id,
                endStepId: bSteps[run[run.length - 1]!.bIdx]!.id,
              });
            }
          } else {
            fingerprintToGroup.set(fingerprint, {
              fingerprint,
              stepCount: run.length,
              members: [
                {
                  caseId: aId,
                  startStepId: aSteps[run[0]!.aIdx]!.id,
                  endStepId: aSteps[run[run.length - 1]!.aIdx]!.id,
                },
                {
                  caseId: bId,
                  startStepId: bSteps[run[0]!.bIdx]!.id,
                  endStepId: bSteps[run[run.length - 1]!.bIdx]!.id,
                },
              ],
            });
          }
        }
      }
    }

    // 3. Return only groups that have >= 2 members (sanity check — all should)
    return Array.from(fingerprintToGroup.values()).filter(
      (g) => g.members.length >= 2,
    );
  }
}

// ---------------------------------------------------------------------------
// Exported helper (also used in unit tests)
// ---------------------------------------------------------------------------

/**
 * Extract contiguous runs of consecutive index pairs from LCS output.
 *
 * A run is contiguous when:
 *   pairs[i+1].aIdx === pairs[i].aIdx + 1
 *   AND
 *   pairs[i+1].bIdx === pairs[i].bIdx + 1
 *
 * Only runs of length >= minSteps are returned. Non-contiguous LCS matches
 * (gaps in either sequence) are split into separate runs.
 *
 * This post-processing step is required because the standard LCS algorithm
 * finds the longest common *subsequence* (which may have gaps), but we only
 * want to report *contiguous* shared step ranges.
 */
export function extractContiguousRuns(
  pairs: Array<{ aIdx: number; bIdx: number }>,
  minSteps: number,
): Array<Array<{ aIdx: number; bIdx: number }>> {
  if (pairs.length === 0) return [];

  const runs: Array<Array<{ aIdx: number; bIdx: number }>> = [];
  let current = [pairs[0]!];

  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1]!;
    const curr = pairs[i]!;
    if (curr.aIdx === prev.aIdx + 1 && curr.bIdx === prev.bIdx + 1) {
      current.push(curr);
    } else {
      if (current.length >= minSteps) runs.push(current);
      current = [curr];
    }
  }

  if (current.length >= minSteps) runs.push(current);
  return runs;
}
