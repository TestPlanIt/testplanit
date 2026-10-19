import { generateTestCasesForProject } from "~/app/api/llm/generate-test-cases/core";
import type { IssueData } from "~/app/api/llm/generate-test-cases/shared";
import { issueInProjectWhere } from "~/lib/issues/projectMembershipWhere";
import {
  getProjectReadiness,
  listProjectTemplates,
  loadTemplateData,
  resolveImportTarget,
  toImportCases,
} from "~/lib/services/jira-panel-generation";
import { NotificationService } from "~/lib/services/notificationService";
import {
  persistGeneratedTestCases,
  type ImportInput,
} from "~/lib/services/testCaseImport";
import { webhookActorId } from "./actor";
import { logWebhookAction } from "./log";
import { describeDraftCasesRule, draftFolderNote } from "./ruleSummary";
import { readDraftCasesOptions, readWebhookActionFilter } from "./schemas";

export interface DraftCasesJob {
  deliveryId: string;
  webhookConfigId: string;
  webhookActionId: string;
  projectId: number;
  issueId: number;
  tenantId?: string;
}

export type DraftCasesResult =
  | { outcome: "cases_drafted"; caseCount: number; folderId: number }
  | {
      outcome:
        | "rule_gone"
        | "issue_gone"
        | "has_cases"
        | "no_llm"
        | "no_template"
        | "no_target";
    }
  | { outcome: "draft_failed"; detail: string };

/**
 * Draft test cases for one issue with the project's AI model, the way the
 * Repository's Generate wizard does, into a top-level folder named after
 * the rule (one folder per rule, its note saying which webhook and rule
 * fill it), in the state the rule chose, linked to the issue and created
 * by the System user. An issue that already has linked cases is left
 * alone, which also keeps a retried job from drafting twice. Recipients
 * the rule names are notified.
 */
export async function runDraftCases(
  db: any,
  job: DraftCasesJob
): Promise<DraftCasesResult> {
  const annotate = async (error: string) => {
    await db.webhookDelivery
      .update({ where: { id: job.deliveryId }, data: { error } })
      .catch(() => {});
  };
  const log = (entry: {
    outcome: string;
    caseCount?: number | null;
    folderId?: number | null;
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
    select: {
      isEnabled: true,
      trigger: true,
      filter: true,
      options: true,
      webhookConfig: { select: { name: true, adapterType: true } },
    },
  });
  if (!rule?.isEnabled) return { outcome: "rule_gone" };
  const options = readDraftCasesOptions(rule.options);
  const filter = readWebhookActionFilter(rule.filter);
  // Tags are generated unless the rule switched them off, as in the wizard.
  const autoGenerateTags = options.autoGenerateTags ?? true;

  const issue = await db.issue.findFirst({
    where: { id: job.issueId, ...issueInProjectWhere(job.projectId) },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      externalKey: true,
      isDeleted: true,
    },
  });
  if (!issue || issue.isDeleted) {
    return { outcome: "issue_gone" };
  }

  // Deleted cases don't count: drafts someone threw away can be redone.
  const linked = await db.repositoryCaseIssue.count({
    where: { issueId: issue.id, case: { isDeleted: false } },
  });
  if (linked > 0) {
    await log({ outcome: "has_cases" });
    await annotate("ignored:has_cases");
    return { outcome: "has_cases" };
  }

  const readiness = await getProjectReadiness(job.projectId, db);
  if (!readiness.hasActiveLlm) {
    await log({ outcome: "no_llm" });
    await annotate("ignored:no_llm");
    return { outcome: "no_llm" };
  }

  const templateId =
    options.templateId ?? (await defaultTemplateId(db, job.projectId));
  const loaded = templateId ? await loadTemplateData(templateId, db) : null;
  if (!loaded) {
    await log({ outcome: "no_template" });
    await annotate("draft:no_template");
    return { outcome: "no_template" };
  }

  const project = await db.projects.findUnique({
    where: { id: job.projectId },
    select: { createdBy: true },
  });
  const actorId = await webhookActorId(db, project?.createdBy ?? "");
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });

  // The folder is the rule's: every issue the rule drafts for lands in it.
  const ruleLine =
    (await describeDraftCasesRule({
      trigger: rule.trigger,
      statuses:
        rule.trigger === "ISSUE_STATUS_ENTERED" ? filter.statuses : undefined,
    })) ?? loaded.template.name;
  const target = await resolveImportTarget(
    job.projectId,
    actorId,
    {
      newFolderName: ruleLine,
    },
    db
  );
  if (!target) {
    await log({ outcome: "no_target" });
    await annotate("draft:no_target");
    return { outcome: "no_target" };
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
    : null;
  if (state) {
    target.stateId = state.id;
    target.stateName = state.name;
  }
  await noteFolder(db, target.folderId, () =>
    draftFolderNote({
      webhook: rule.webhookConfig,
      ruleLine,
      filter,
      templateName: loaded.template.name,
      stateName: target.stateName,
    })
  );

  const issueData: IssueData = {
    key: issue.externalKey ?? issue.name,
    title: issue.title,
    description: issue.description ?? undefined,
    status: issue.status ?? "",
    priority: issue.priority ?? undefined,
  };
  const generated = await generateTestCasesForProject({
    projectId: job.projectId,
    issue: issueData,
    template: loaded.template,
    context: { folderContext: target.folderId },
    quantity: options.quantity,
    autoGenerateTags,
    userId: actorId,
  });
  if (!generated.ok) {
    const detail = String(generated.body.error ?? "generation failed");
    await log({ outcome: "draft_failed", detail });
    await annotate(`draft:${detail.slice(0, 200)}`);
    return { outcome: "draft_failed", detail };
  }
  const cases = toImportCases(loaded.template, generated.testCases);
  if (cases.length === 0) {
    const detail = "The model returned no test cases";
    await log({ outcome: "draft_failed", detail });
    await annotate("draft:no_cases_generated");
    return { outcome: "draft_failed", detail };
  }

  const input: ImportInput = {
    projectId: job.projectId,
    projectName: target.projectName,
    repositoryId: target.repositoryId,
    folderId: target.folderId,
    folderName: target.folderName,
    templateId: loaded.template.id,
    templateName: loaded.template.name,
    stateId: target.stateId,
    stateName: target.stateName,
    maxOrder: target.maxOrder,
    autoGenerateTags,
    testCases: cases,
    fieldMappings: loaded.fieldMappings,
    linkIssueId: issue.id,
  };
  const result = await persistGeneratedTestCases(input, {
    userId: actorId,
    userName: actor?.name ?? "System",
  });
  if (result.status === "error" || result.importedCount === 0) {
    const detail = result.errors[0] ?? result.message ?? "import failed";
    await log({ outcome: "draft_failed", detail });
    await annotate(`draft:${detail.slice(0, 200)}`);
    return { outcome: "draft_failed", detail };
  }

  await log({
    outcome: "cases_drafted",
    caseCount: result.importedCount,
    folderId: target.folderId,
  });

  const recipients = await recipientIds(db, options);
  for (const userId of recipients) {
    await NotificationService.createCasesDraftedNotification({
      userId,
      projectId: job.projectId,
      projectName: target.projectName,
      folderId: target.folderId,
      folderName: target.folderName,
      issueId: issue.id,
      issueKey: issueData.key,
      issueTitle: issue.title,
      caseCount: result.importedCount,
      tenantId: job.tenantId,
    });
  }

  return {
    outcome: "cases_drafted",
    caseCount: result.importedCount,
    folderId: target.folderId,
  };
}

async function defaultTemplateId(
  db: any,
  projectId: number
): Promise<number | null> {
  const templates = await listProjectTemplates(projectId, db);
  return (templates.find((t) => t.isDefault) ?? templates[0])?.id ?? null;
}

/** Give a folder its note the first time a rule fills it. */
async function noteFolder(
  db: any,
  folderId: number,
  note: () => Promise<unknown>
): Promise<void> {
  const folder = await db.repositoryFolders.findUnique({
    where: { id: folderId },
    select: { docs: true },
  });
  if (!folder || hasContent(folder.docs)) return;
  await db.repositoryFolders
    .update({ where: { id: folderId }, data: { docs: await note() } })
    .catch(() => {});
}

function hasContent(docs: unknown): boolean {
  if (!docs) return false;
  const doc = typeof docs === "string" ? safeParse(docs) : docs;
  const content = (doc as { content?: unknown } | null)?.content;
  return Array.isArray(content) && content.length > 0;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The users a rule notifies: those named, plus the members of its groups. */
async function recipientIds(
  db: any,
  options: { notifyUserIds?: string[]; notifyGroupIds?: number[] }
): Promise<string[]> {
  const ids = new Set(options.notifyUserIds ?? []);
  if (options.notifyGroupIds?.length) {
    const members: { userId: string }[] = await db.groupAssignment.findMany({
      where: { groupId: { in: options.notifyGroupIds } },
      select: { userId: true },
    });
    for (const member of members) ids.add(member.userId);
  }
  return [...ids];
}
