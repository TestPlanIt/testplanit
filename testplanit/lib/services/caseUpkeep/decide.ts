import { z } from "zod/v4";
import { loadTemplateData } from "~/lib/services/jira-panel-generation";
import { rewriteCase } from "./rewrite";

const caseTextSchema = z.object({
  name: z.string(),
  fieldValues: z.record(z.string(), z.unknown()),
  steps: z.array(z.object({ step: z.string(), expectedResult: z.string() })),
});

/**
 * A suggestion's proposed case, as it is stored: the case after the change,
 * and `base`, the case as it read when the suggestion was made, which is what
 * the proposal is shown against.
 */
export const proposedCaseSchema = caseTextSchema.extend({
  templateId: z.number().int(),
  base: caseTextSchema.optional(),
});
export type ProposedCase = z.infer<typeof proposedCaseSchema>;

export type DecideResult =
  | { ok: true; status: "APPLIED" | "DISMISSED" }
  | {
      ok: false;
      /**
       * not_found: no such suggestion on this case. not_pending: already
       * decided or superseded. gone: the case was deleted. stale: the case
       * has changed since the suggestion was made, so it cannot be applied
       * as it stands.
       */
      code: "not_found" | "not_pending" | "gone" | "stale";
    };

/**
 * Apply or dismiss a pending suggestion, inside the caller's transaction and
 * after the caller has checked the user may edit the case.
 *
 * Applying an update saves the proposed case as a normal edit (a new version);
 * applying a retirement archives the case. Either way the user becomes the
 * case's reviewer. Both applying and dismissing mark the case as aligned with
 * the issue, so the suggestion is not raised again until the issue changes.
 */
export async function decideSuggestion(
  tx: any,
  params: {
    suggestionId: number;
    caseId: number;
    action: "apply" | "dismiss";
    userId: string;
  }
): Promise<DecideResult> {
  const { suggestionId, caseId, action, userId } = params;
  const found = await tx.caseChangeSuggestion.findFirst({
    where: { id: suggestionId, caseId },
    select: { issueId: true },
  });
  if (!found) return { ok: false, code: "not_found" };
  // The same lock the update job takes: it cannot supersede this suggestion
  // while it is being decided.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${caseId}::int, ${found.issueId}::int)`;
  const suggestion = await tx.caseChangeSuggestion.findFirst({
    where: { id: suggestionId, caseId },
    select: {
      status: true,
      kind: true,
      issueId: true,
      baseCaseVersion: true,
      proposed: true,
    },
  });
  if (suggestion.status !== "PENDING")
    return { ok: false, code: "not_pending" };

  const now = new Date();
  const close = async (status: "APPLIED" | "DISMISSED") => {
    await tx.caseChangeSuggestion.update({
      where: { id: suggestionId },
      data: { status, decidedById: userId, decidedAt: now },
    });
    await tx.repositoryCaseIssue.updateMany({
      where: { caseId, issueId: suggestion.issueId },
      data: { alignedAt: now },
    });
    return { ok: true as const, status };
  };
  if (action === "dismiss") return close("DISMISSED");

  const testCase = await tx.repositoryCases.findFirst({
    where: { id: caseId, isDeleted: false },
    select: { currentVersion: true, templateId: true },
  });
  if (!testCase) return { ok: false, code: "gone" };
  if (testCase.currentVersion !== suggestion.baseCaseVersion) {
    return { ok: false, code: "stale" };
  }

  if (suggestion.kind === "RETIRE") {
    await tx.repositoryCases.update({
      where: { id: caseId },
      data: { isDeleted: true },
    });
    return close("APPLIED");
  }

  const proposed = proposedCaseSchema.safeParse(suggestion.proposed);
  if (!proposed.success || proposed.data.templateId !== testCase.templateId) {
    return { ok: false, code: "stale" };
  }
  const loaded = await loadTemplateData(testCase.templateId, tx);
  if (!loaded) return { ok: false, code: "stale" };
  const written = await rewriteCase(tx, {
    caseId,
    expectedVersion: testCase.currentVersion,
    proposed: {
      name: proposed.data.name,
      fieldValues: proposed.data.fieldValues,
      steps: proposed.data.steps,
    },
    fieldMappings: loaded.fieldMappings,
  });
  if (!written.ok) {
    return { ok: false, code: written.reason === "gone" ? "gone" : "stale" };
  }
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: { reviewedById: userId, reviewedAt: now },
  });
  return close("APPLIED");
}
