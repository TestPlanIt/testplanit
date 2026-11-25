import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { loadTemplateData } from "~/lib/services/jira-panel-generation";
import { toUpkeepCase } from "./caseText";
import { reviewCasesAgainstIssue } from "./review";

export type RegenerateResult =
  | { ok: true; outcome: "suggested" | "up_to_date" }
  | {
      ok: false;
      code: "not_found" | "not_pending" | "gone" | "no_llm" | "failed";
      detail?: string;
    };

/**
 * Work a pending suggestion out again against the case and the issue as they
 * read now, for a suggestion whose case has been edited since it was made.
 * The old suggestion is superseded by a new one, or, when the model now finds
 * nothing to change, closed with the case marked as aligned. The case itself
 * is never written: a person asked, so a person decides.
 */
export async function regenerateSuggestion(
  db: any,
  params: {
    suggestionId: number;
    caseId: number;
    userId: string;
    tenantId?: string;
  }
): Promise<RegenerateResult> {
  const { suggestionId, caseId } = params;
  const suggestion = await db.caseChangeSuggestion.findFirst({
    where: { id: suggestionId, caseId },
    select: {
      status: true,
      projectId: true,
      issueId: true,
      webhookActionId: true,
    },
  });
  if (!suggestion) return { ok: false, code: "not_found" };
  if (suggestion.status !== "PENDING")
    return { ok: false, code: "not_pending" };

  const [row, issue] = await Promise.all([
    db.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: {
        id: true,
        name: true,
        templateId: true,
        currentVersion: true,
        caseFieldValues: { select: { fieldId: true, value: true } },
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          select: { step: true, expectedResult: true, sharedStepGroupId: true },
        },
      },
    }),
    db.issue.findFirst({
      where: { id: suggestion.issueId, isDeleted: false },
      select: {
        name: true,
        externalKey: true,
        title: true,
        description: true,
        contentUpdatedAt: true,
      },
    }),
  ]);
  if (!row || !issue) return { ok: false, code: "gone" };
  const loaded = await loadTemplateData(row.templateId, db);
  if (!loaded) return { ok: false, code: "gone" };

  const reviewed = await reviewCasesAgainstIssue(db, {
    projectId: suggestion.projectId,
    tenantId: params.tenantId,
    userId: params.userId,
    issue: {
      key: issue.externalKey ?? issue.name,
      title: issue.title,
      description: issue.description ?? "",
      previous: null,
    },
    otherIssues: [],
    cases: [toUpkeepCase(row, loaded.fieldMappings)],
    template: loaded.template,
  });
  if (!reviewed.ok) {
    return reviewed.reason === "no_llm"
      ? { ok: false, code: "no_llm" }
      : { ok: false, code: "failed", detail: reviewed.detail };
  }
  const decision = reviewed.decisions[0];
  const read = toUpkeepCase(row, loaded.fieldMappings);
  const base = {
    name: read.name,
    fieldValues: read.fieldValues,
    steps: read.steps,
  };

  return auditedTransaction(async (tx: any): Promise<RegenerateResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${caseId}::int, ${suggestion.issueId}::int)`;
    const [current, fresh] = await Promise.all([
      tx.caseChangeSuggestion.findFirst({
        where: { id: suggestionId },
        select: { status: true },
      }),
      tx.repositoryCases.findFirst({
        where: { id: caseId, isDeleted: false },
        select: { currentVersion: true },
      }),
    ]);
    if (current?.status !== "PENDING")
      return { ok: false, code: "not_pending" };
    // Saved again while the model was reading it: the answer is out of date.
    if (!fresh || fresh.currentVersion !== row.currentVersion) {
      return { ok: false, code: "gone" };
    }
    await tx.caseChangeSuggestion.update({
      where: { id: suggestionId },
      data: { status: "SUPERSEDED" },
    });
    if (!decision || decision.action === "unchanged") {
      await tx.repositoryCaseIssue.updateMany({
        where: { caseId, issueId: suggestion.issueId },
        data: { alignedAt: new Date() },
      });
      return { ok: true, outcome: "up_to_date" };
    }
    await tx.caseChangeSuggestion.create({
      data: {
        projectId: suggestion.projectId,
        caseId,
        issueId: suggestion.issueId,
        issueContentUpdatedAt: issue.contentUpdatedAt ?? null,
        baseCaseVersion: fresh.currentVersion,
        kind: decision.action === "update" ? "UPDATE" : "RETIRE",
        ...(decision.action === "update"
          ? {
              proposed: {
                templateId: row.templateId,
                base,
                ...decision.proposed,
              },
            }
          : {}),
        rationale: decision.reason || null,
        webhookActionId: suggestion.webhookActionId,
      },
    });
    return { ok: true, outcome: "suggested" };
  });
}
