import type { TemplateData } from "~/app/api/llm/generate-test-cases/shared";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { issueInProjectWhere } from "~/lib/issues/projectMembershipWhere";
import {
  toUpkeepCase,
  type UpkeepCase,
  type UpkeepCaseRow,
  type UpkeepCaseText,
} from "~/lib/services/caseUpkeep/caseText";
import type { UpkeepDecision } from "~/lib/services/caseUpkeep/decisions";
import {
  reviewersOf,
  upkeepRecipients,
} from "~/lib/services/caseUpkeep/recipients";
import {
  reviewCasesAgainstIssue,
  type ReviewIssue,
} from "~/lib/services/caseUpkeep/review";
import { rewriteCase } from "~/lib/services/caseUpkeep/rewrite";
import {
  loadTemplateData,
  resolveImportTarget,
  toImportCases,
  type FieldMapping,
} from "~/lib/services/jira-panel-generation";
import { NotificationService } from "~/lib/services/notificationService";
import {
  persistGeneratedTestCases,
  type ImportInput,
} from "~/lib/services/testCaseImport";
import { webhookActorId } from "./actor";
import { aiDraftState, markAiWritten } from "./aiDrafts";
import { logWebhookAction } from "./log";
import { readUpdateCasesOptions, type UpdateCasesOptions } from "./schemas";

export interface UpdateCasesJob {
  deliveryId: string;
  webhookConfigId: string;
  webhookActionId: string;
  projectId: number;
  issueId: number;
  tenantId?: string;
}

export interface UpdateCasesCounts {
  /** Cases the model was asked about. */
  checked: number;
  rewritten: number;
  added: number;
  deleted: number;
  suggested: number;
}

export type UpdateCasesResult =
  | ({ outcome: "cases_updated" | "no_changes" } & UpdateCasesCounts)
  | {
      outcome:
        "rule_gone" | "issue_gone" | "no_cases" | "up_to_date" | "no_llm";
    }
  | { outcome: "update_failed"; detail: string };

interface LinkedCase extends UpkeepCaseRow {
  templateId: number;
  folderId: number;
  currentVersion: number;
  reviewedById: string | null;
}

interface IssueVersionRow {
  title: string;
  description: string | null;
  changedAt: Date;
}

/**
 * The issue text the cases were last aligned with, from a requirement's
 * version history (oldest first): the newest version no later than `since`,
 * or the oldest when none is that old. Null when that is the text as it
 * reads now, or there is no history.
 */
export function previousIssueText(
  versions: IssueVersionRow[],
  since: Date | null
): { title: string; description: string } | null {
  if (versions.length < 2) return null;
  const upTo = since
    ? versions.filter((version) => version.changedAt <= since)
    : [];
  const chosen = upTo.length > 0 ? upTo[upTo.length - 1] : versions[0];
  if (chosen === versions[versions.length - 1]) return null;
  return { title: chosen.title, description: chosen.description ?? "" };
}

/** The value that occurs most often; the first seen wins a tie. */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Bring the test cases linked to an issue in line with its changed text.
 * The project's AI model reads each case against the issue. A case still in
 * an AI-draft state that nobody has saved since the AI wrote it is rewritten
 * in place, or deleted when the issue no longer asks for it; every other case
 * gets a suggestion for a person to apply or dismiss. Something the issue now
 * asks for that no case covers becomes a new draft. A case already aligned
 * with the issue's current text is skipped, so a retried job repeats nothing.
 * Automated cases are left out: their text follows the test code, and results
 * are matched to them by name.
 */
export async function runUpdateCases(
  db: any,
  job: UpdateCasesJob
): Promise<UpdateCasesResult> {
  const log = (entry: {
    outcome: string;
    caseCount?: number | null;
    detail?: string | null;
  }) =>
    logWebhookAction(db, {
      webhookActionId: job.webhookActionId,
      webhookConfigId: job.webhookConfigId,
      deliveryId: job.deliveryId,
      projectId: job.projectId,
      issueId: job.issueId,
      ...entry,
    });

  const rule = await db.webhookAction.findUnique({
    where: { id: job.webhookActionId },
    select: { isEnabled: true, options: true },
  });
  if (!rule?.isEnabled) return { outcome: "rule_gone" };
  const options = readUpdateCasesOptions(rule.options);

  const issue = await db.issue.findFirst({
    where: { id: job.issueId, ...issueInProjectWhere(job.projectId) },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      externalKey: true,
      isDeleted: true,
      isRequirement: true,
      contentUpdatedAt: true,
    },
  });
  if (!issue || issue.isDeleted) return { outcome: "issue_gone" };
  const issueKey: string = issue.externalKey ?? issue.name;

  const links: { alignedAt: Date | null; case: LinkedCase }[] =
    await db.repositoryCaseIssue.findMany({
      where: {
        issueId: issue.id,
        case: {
          projectId: job.projectId,
          isDeleted: false,
          isArchived: false,
          automated: false,
          ...(options.scope === "ai_drafted"
            ? { aiWrittenVersion: { not: null } }
            : {}),
        },
      },
      orderBy: { caseId: "asc" },
      select: {
        alignedAt: true,
        case: {
          select: {
            id: true,
            name: true,
            templateId: true,
            folderId: true,
            currentVersion: true,
            reviewedById: true,
            caseFieldValues: { select: { fieldId: true, value: true } },
            steps: {
              where: { isDeleted: false },
              orderBy: { order: "asc" },
              select: {
                step: true,
                expectedResult: true,
                sharedStepGroupId: true,
              },
            },
          },
        },
      },
    });
  if (links.length === 0) {
    await log({ outcome: "no_cases" });
    return { outcome: "no_cases" };
  }
  const changedAt: Date | null = issue.contentUpdatedAt ?? null;
  // Behind the issue: never aligned with it, or aligned before its text
  // last changed. An issue whose text was never edited has nothing newer
  // than a case already aligned with it.
  const stale = links.filter(
    (link) =>
      !link.alignedAt || (changedAt !== null && link.alignedAt < changedAt)
  );
  if (stale.length === 0) {
    await log({ outcome: "up_to_date", caseCount: links.length });
    return { outcome: "up_to_date" };
  }

  const project = await db.projects.findUnique({
    where: { id: job.projectId },
    select: { name: true, createdBy: true },
  });
  const actorId = await webhookActorId(db, project?.createdBy ?? "");
  const projectName: string = project?.name ?? "";
  const tell = (
    recipients: string[],
    notification: Omit<
      Parameters<typeof NotificationService.createCasesUpdatedNotification>[0],
      | "userId"
      | "projectId"
      | "projectName"
      | "issueId"
      | "issueKey"
      | "issueTitle"
      | "tenantId"
    >
  ) =>
    Promise.all(
      recipients.map((userId) =>
        NotificationService.createCasesUpdatedNotification({
          userId,
          projectId: job.projectId,
          projectName,
          issueId: issue.id,
          issueKey,
          issueTitle: issue.title,
          tenantId: job.tenantId,
          ...notification,
        })
      )
    );
  const fail = async (detail: string): Promise<UpdateCasesResult> => {
    await log({ outcome: "update_failed", detail });
    await tell(
      await upkeepRecipients(db, {
        projectId: job.projectId,
        issueId: issue.id,
        options,
      }),
      { kind: "failed", detail }
    );
    return { outcome: "update_failed", detail };
  };

  let previous: ReviewIssue["previous"] = null;
  if (issue.isRequirement) {
    const versions: IssueVersionRow[] = await db.issueVersions.findMany({
      where: { issueId: issue.id },
      orderBy: { version: "asc" },
      select: { title: true, description: true, changedAt: true },
    });
    const everAligned = stale.every((link) => link.alignedAt);
    previous = previousIssueText(
      versions,
      everAligned
        ? new Date(Math.min(...stale.map((link) => link.alignedAt!.getTime())))
        : null
    );
  }
  const reviewIssue: ReviewIssue = {
    key: issueKey,
    title: issue.title,
    description: issue.description ?? "",
    previous,
  };

  const caseIds = stale.map((link) => link.case.id);
  const otherLinks: {
    issue: { name: string; externalKey: string | null; title: string };
  }[] = await db.repositoryCaseIssue.findMany({
    where: {
      caseId: { in: caseIds },
      issueId: { not: issue.id },
      issue: { isDeleted: false },
    },
    select: {
      issue: { select: { name: true, externalKey: true, title: true } },
    },
    take: 200,
  });
  const otherIssues = [
    ...new Map(
      otherLinks.map((link) => {
        const key = link.issue.externalKey ?? link.issue.name;
        return [key, { key, title: link.issue.title }] as const;
      })
    ).values(),
  ].slice(0, 20);

  // One request per template, the template most of the cases use first: it is
  // the one whose answer may add cases.
  const templateIds = [...new Set(stale.map((link) => link.case.templateId))];
  const leading = mostCommon(stale.map((link) => link.case.templateId));
  templateIds.sort((a, b) => Number(b === leading) - Number(a === leading));

  const problems: string[] = [];
  const planned: {
    decision: UpkeepDecision;
    row: LinkedCase;
    /** The case as the model read it. */
    base: UpkeepCaseText;
    fieldMappings: FieldMapping[];
  }[] = [];
  let additions: {
    cases: UpkeepCaseText[];
    template: TemplateData;
    fieldMappings: FieldMapping[];
  } | null = null;
  let checked = 0;

  for (const templateId of templateIds) {
    const loaded = await loadTemplateData(templateId, db);
    if (!loaded) {
      problems.push(`template ${templateId} could not be read`);
      continue;
    }
    const rows = stale
      .map((link) => link.case)
      .filter((row) => row.templateId === templateId);
    const cases: UpkeepCase[] = rows.map((row) =>
      toUpkeepCase(row, loaded.fieldMappings)
    );
    const reviewed = await reviewCasesAgainstIssue(db, {
      projectId: job.projectId,
      tenantId: job.tenantId,
      userId: actorId,
      issue: reviewIssue,
      otherIssues,
      cases,
      template: loaded.template,
    });
    if (!reviewed.ok) {
      if (reviewed.reason === "no_llm") {
        await log({ outcome: "no_llm" });
        return { outcome: "no_llm" };
      }
      return fail(reviewed.detail);
    }
    checked += cases.length;
    problems.push(...reviewed.problems);
    for (const decision of reviewed.decisions) {
      const row = rows.find((candidate) => candidate.id === decision.caseId);
      const read = cases.find((candidate) => candidate.id === decision.caseId);
      if (row && read) {
        planned.push({
          decision,
          row,
          base: {
            name: read.name,
            fieldValues: read.fieldValues,
            steps: read.steps,
          },
          fieldMappings: loaded.fieldMappings,
        });
      }
    }
    if (templateId === leading && reviewed.newCases.length > 0) {
      additions = {
        cases: reviewed.newCases,
        template: loaded.template,
        fieldMappings: loaded.fieldMappings,
      };
    }
  }
  if (checked === 0) return fail(problems.join("; "));

  const counts = { rewritten: 0, added: 0, deleted: 0, suggested: 0 };
  const deletedNames: string[] = [];
  const suggestedFor: LinkedCase[] = [];
  const now = new Date();

  for (const { decision, row, base, fieldMappings } of planned) {
    try {
      await auditedTransaction(async (tx: any) => {
        // One writer per case and issue: two rules firing on the same issue
        // must not both leave a pending suggestion.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${row.id}::int, ${issue.id}::int)`;
        const fresh = await tx.repositoryCases.findFirst({
          where: { id: row.id, isDeleted: false },
          select: {
            currentVersion: true,
            aiWrittenVersion: true,
            state: { select: { isAiDraft: true } },
          },
        });
        // Saved or deleted while the model was reading it: its answer is
        // about text that is no longer there.
        if (!fresh || fresh.currentVersion !== row.currentVersion) {
          problems.push(`case ${row.id} changed while it was being checked`);
          return;
        }
        const mayRewrite =
          fresh.state?.isAiDraft === true &&
          fresh.aiWrittenVersion === fresh.currentVersion;
        const supersede = () =>
          tx.caseChangeSuggestion.updateMany({
            where: { caseId: row.id, issueId: issue.id, status: "PENDING" },
            data: { status: "SUPERSEDED" },
          });
        const align = () =>
          tx.repositoryCaseIssue.updateMany({
            where: { caseId: row.id, issueId: issue.id },
            data: { alignedAt: now },
          });
        const suggest = (
          kind: "UPDATE" | "RETIRE",
          rationale: string,
          proposed: UpkeepCaseText | null
        ) =>
          tx.caseChangeSuggestion.create({
            data: {
              projectId: job.projectId,
              caseId: row.id,
              issueId: issue.id,
              issueContentUpdatedAt: changedAt,
              baseCaseVersion: fresh.currentVersion,
              kind,
              ...(proposed
                ? {
                    proposed: { templateId: row.templateId, base, ...proposed },
                  }
                : {}),
              rationale: rationale || null,
              webhookActionId: job.webhookActionId,
              deliveryId: job.deliveryId,
            },
          });

        await supersede();
        if (decision.action === "unchanged") {
          await align();
          return;
        }
        if (!mayRewrite) {
          await suggest(
            decision.action === "update" ? "UPDATE" : "RETIRE",
            decision.reason,
            decision.action === "update" ? decision.proposed : null
          );
          counts.suggested++;
          suggestedFor.push(row);
          return;
        }
        if (decision.action === "retire") {
          await tx.repositoryCases.update({
            where: { id: row.id },
            data: { isDeleted: true },
          });
          counts.deleted++;
          deletedNames.push(row.name);
          return;
        }
        const written = await rewriteCase(tx, {
          caseId: row.id,
          expectedVersion: fresh.currentVersion,
          proposed: decision.proposed,
          fieldMappings,
        });
        if (!written.ok) {
          problems.push(`case ${row.id} could not be rewritten`);
          return;
        }
        if (written.skippedFields.length > 0) {
          problems.push(
            `case ${row.id}: left ${written.skippedFields.join(", ")} as it was`
          );
        }
        await tx.repositoryCases.update({
          where: { id: row.id },
          data: { aiWrittenVersion: written.version },
        });
        await align();
        counts.rewritten++;
      });
    } catch (error) {
      console.error(
        `[webhook-actions] updating case ${row.id} for issue ${issueKey} failed:`,
        error
      );
      problems.push(
        `case ${row.id}: ${error instanceof Error ? error.message : "failed"}`
      );
    }
  }

  if (additions) {
    counts.added = await addCases(db, {
      job,
      options,
      actorId,
      folderId: mostCommon(stale.map((link) => link.case.folderId)),
      additions,
      problems,
    });
  }

  const touched =
    counts.rewritten + counts.added + counts.deleted + counts.suggested;
  const detail = [
    `checked ${checked}: ${counts.rewritten} rewritten, ${counts.added} added, ${counts.deleted} deleted, ${counts.suggested} suggested`,
    ...problems,
  ].join("; ");
  if (touched === 0) {
    await log({ outcome: "no_changes", caseCount: checked, detail });
    return { outcome: "no_changes", checked, ...counts };
  }
  await log({ outcome: "cases_updated", caseCount: touched, detail });

  await tell(
    await upkeepRecipients(db, {
      projectId: job.projectId,
      issueId: issue.id,
      options,
      alsoTell: await reviewersOf(db, suggestedFor),
    }),
    { kind: "summary", ...counts, deletedNames }
  );
  return { outcome: "cases_updated", checked, ...counts };
}

/**
 * Record that an Update test cases job gave up, and tell the rule's
 * recipients. For a job that threw on its last attempt: a check the model
 * could not finish reports itself from inside the job.
 */
export async function reportUpdateCasesFailure(
  db: any,
  job: UpdateCasesJob,
  detail: string
): Promise<void> {
  await logWebhookAction(db, {
    webhookActionId: job.webhookActionId,
    webhookConfigId: job.webhookConfigId,
    deliveryId: job.deliveryId,
    projectId: job.projectId,
    issueId: job.issueId,
    outcome: "update_failed",
    detail,
  });
  const [rule, issue, project] = await Promise.all([
    db.webhookAction.findUnique({
      where: { id: job.webhookActionId },
      select: { options: true },
    }),
    db.issue.findUnique({
      where: { id: job.issueId },
      select: { name: true, externalKey: true, title: true },
    }),
    db.projects.findUnique({
      where: { id: job.projectId },
      select: { name: true },
    }),
  ]);
  if (!issue) return;
  const recipients = await upkeepRecipients(db, {
    projectId: job.projectId,
    issueId: job.issueId,
    options: readUpdateCasesOptions(rule?.options),
  });
  await Promise.all(
    recipients.map((userId) =>
      NotificationService.createCasesUpdatedNotification({
        userId,
        kind: "failed",
        projectId: job.projectId,
        projectName: project?.name ?? "",
        issueId: job.issueId,
        issueKey: issue.externalKey ?? issue.name,
        issueTitle: issue.title,
        detail,
        tenantId: job.tenantId,
      })
    )
  );
}

/** Create the cases the model added, as AI drafts linked to the issue. */
async function addCases(
  db: any,
  params: {
    job: UpdateCasesJob;
    options: UpdateCasesOptions;
    actorId: string;
    folderId: number | undefined;
    additions: {
      cases: UpkeepCaseText[];
      template: TemplateData;
      fieldMappings: FieldMapping[];
    };
    problems: string[];
  }
): Promise<number> {
  const { job, options, actorId, additions, problems } = params;
  const target = await resolveImportTarget(
    job.projectId,
    actorId,
    { folderId: params.folderId },
    db
  );
  if (!target) {
    problems.push("new cases had nowhere to go");
    return 0;
  }
  const state = options.stateId
    ? await db.workflows.findFirst({
        where: {
          id: options.stateId,
          scope: "CASES",
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId: job.projectId } },
        },
        select: { id: true, name: true },
      })
    : await aiDraftState(db, job.projectId);
  if (state) {
    target.stateId = state.id;
    target.stateName = state.name;
  }
  const stepsField = additions.template.fields.find(
    (field) => field.type.toLowerCase() === "steps"
  );
  const autoGenerateTags = options.autoGenerateTags ?? false;
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  const input: ImportInput = {
    projectId: job.projectId,
    projectName: target.projectName,
    repositoryId: target.repositoryId,
    folderId: target.folderId,
    folderName: target.folderName,
    templateId: additions.template.id,
    templateName: additions.template.name,
    stateId: target.stateId,
    stateName: target.stateName,
    maxOrder: target.maxOrder,
    autoGenerateTags,
    testCases: toImportCases(
      additions.template,
      additions.cases.map((added, index) => ({
        id: `added-${index}`,
        name: added.name,
        fieldValues: {
          ...added.fieldValues,
          ...(stepsField ? { [stepsField.name]: added.steps } : {}),
        },
      }))
    ),
    fieldMappings: additions.fieldMappings,
    linkIssueId: job.issueId,
  };
  const result = await persistGeneratedTestCases(input, {
    userId: actorId,
    userName: actor?.name ?? "System",
  });
  problems.push(...result.errors);
  await markAiWritten(db, result.importedIds, job.issueId);
  return result.importedCount;
}
