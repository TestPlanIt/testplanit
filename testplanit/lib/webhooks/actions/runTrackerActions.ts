import type { AdapterType } from "~/zenstack/models";
import {
  resolveSyncedRequirementFlag,
  syncService,
} from "~/lib/integrations/services/SyncService";
import type { IssueData } from "~/lib/integrations/adapters/IssueAdapter";
import { executeAutoRun } from "~/lib/services/impact/autoExecute";
import { getIssueSubtreeIds } from "~/lib/services/requirementHierarchy";
import { inboundProviderForAdapter } from "~/lib/webhooks/inboundProviders";
import { webhookActorId } from "./actor";
import { composeRunFromCases } from "./composeRun";
import { logWebhookAction } from "./log";
import { describeCreateRunRule } from "./ruleSummary";
import { TRACKER_TRIGGERS, readCreateRunOptions } from "./schemas";
import {
  statusChanged,
  trackerRuleFires,
  type IssueChange,
  type IssueFacts,
  type TrackerRule,
} from "./trackerRules";

export interface TrackerActionsJob {
  deliveryId: string;
  webhookConfigId: string;
  projectId: number;
  adapterType: AdapterType;
  /** The issue key the tracker's payload named. */
  externalKey: string;
  tenantId?: string;
}

/** Thrown when another sync holds the issue; the job retries. */
export class IssueSyncBusyError extends Error {
  constructor(key: string) {
    super(`Issue ${key} is being synced; retrying`);
    this.name = "IssueSyncBusyError";
  }
}

export type TrackerActionsResult =
  | {
      outcome: "no_integration" | "not_imported" | "sync_failed";
      detail?: string;
    }
  | { outcome: "done"; issueId: number; runIds: number[] };

/**
 * Perform a tracker webhook's rules for one issue event: refresh the issue
 * from the tracker (importing it only when an Import issues rule takes it),
 * then create a test run for every Create test run rule the event fires —
 * an issue new to TestPlanIt, or one that moved into a chosen status —
 * from the cases linked to the issue (and its child issues when the rule
 * says so), created by the System user and linked to the issue.
 */
export async function runTrackerActions(
  db: any,
  job: TrackerActionsJob
): Promise<TrackerActionsResult> {
  const annotate = async (data: {
    subjectRef?: string;
    error?: string | null;
  }) => {
    await db.webhookDelivery
      .update({ where: { id: job.deliveryId }, data })
      .catch(() => {});
  };

  const rules: TrackerRule[] = await db.webhookAction.findMany({
    where: {
      webhookConfigId: job.webhookConfigId,
      isEnabled: true,
      trigger: { in: [...TRACKER_TRIGGERS] },
      action: { in: ["IMPORT_ISSUE", "CREATE_RUN"] },
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      trigger: true,
      action: true,
      filter: true,
      options: true,
    },
  });
  const importRules = rules.filter((rule) => rule.action === "IMPORT_ISSUE");
  const runRules = rules.filter((rule) => rule.action === "CREATE_RUN");

  const provider = inboundProviderForAdapter(job.adapterType);
  const projectIntegration = provider
    ? await db.projectIntegration.findFirst({
        where: {
          projectId: job.projectId,
          isActive: true,
          integration: { provider, isDeleted: false },
        },
        select: { integrationId: true },
      })
    : null;
  if (!projectIntegration) {
    await annotate({ error: "ignored:no_integration" });
    return { outcome: "no_integration" };
  }
  const integrationId: number = projectIntegration.integrationId;

  const project = await db.projects.findUnique({
    where: { id: job.projectId },
    select: { createdBy: true },
  });
  const actorId = await webhookActorId(db, project?.createdBy ?? "");

  const factsOf = async (issueData: IssueData): Promise<IssueFacts> => ({
    status: issueData.status ?? null,
    issueTypeId: issueData.issueType?.id ?? null,
    labels: issueData.labels ?? [],
    isRequirement:
      (await resolveSyncedRequirementFlag(db, integrationId, job.projectId, {
        issueTypeId: issueData.issueType?.id,
        labels: issueData.labels,
      })) === true,
  });
  const newIssue: IssueChange = { created: true, statusChanged: false };

  const refreshed = await syncService.performIssueRefreshSystem(
    integrationId,
    job.externalKey,
    {
      dbClient: db,
      createIfMissing: {
        projectId: job.projectId,
        createdById: actorId,
        shouldCreate: async (issueData) => {
          if (importRules.length === 0) return false;
          const facts = await factsOf(issueData);
          return importRules.some((rule) =>
            trackerRuleFires(rule, newIssue, facts)
          );
        },
      },
    }
  );
  if (refreshed.locked) throw new IssueSyncBusyError(job.externalKey);
  if (!refreshed.success || !refreshed.issue) {
    if (refreshed.notImported) {
      await annotate({ error: "ignored:not_imported" });
      return { outcome: "not_imported" };
    }
    const detail = refreshed.error ?? "no issue";
    await annotate({ error: `sync:${detail.slice(0, 200)}` });
    return { outcome: "sync_failed", detail };
  }

  const issue = refreshed.issue;
  // An issue deleted in TestPlanIt is still refreshed, but acts on nothing.
  const row = await db.issue.findUnique({
    where: { id: issue.issueId },
    select: { isDeleted: true },
  });
  if (row?.isDeleted) {
    await annotate({ error: "ignored:issue_deleted" });
    return { outcome: "done", issueId: issue.issueId, runIds: [] };
  }
  const change: IssueChange = {
    created: issue.created,
    statusChanged: statusChanged(issue.previousStatus, issue.status),
  };
  const facts: IssueFacts = {
    status: issue.status,
    issueTypeId: issue.issueTypeId,
    labels: issue.labels,
    isRequirement: issue.isRequirement,
  };
  const log = (
    rule: TrackerRule,
    entry: {
      outcome: string;
      testRunId?: number | null;
      caseCount?: number | null;
      detail?: string | null;
    }
  ) =>
    logWebhookAction(db, {
      webhookActionId: rule.id,
      webhookConfigId: job.webhookConfigId,
      deliveryId: job.deliveryId,
      projectId: job.projectId,
      issueId: issue.issueId,
      ...entry,
    });

  if (issue.created) {
    for (const rule of importRules) {
      if (trackerRuleFires(rule, newIssue, facts)) {
        await log(rule, { outcome: "issue_imported" });
      }
    }
  }

  const runIds: number[] = [];
  // A failure outranks a note that a rule acted on nothing.
  let deliveryError: string | null = null;
  let deliveryNote: string | null = null;
  for (const rule of runRules) {
    if (!trackerRuleFires(rule, change, facts)) continue;
    try {
      const options = readCreateRunOptions(rule.options);
      const issueIds = [
        issue.issueId,
        ...(options.includeChildIssues && issue.projectId != null
          ? await getIssueSubtreeIds(issue.issueId, issue.projectId, db)
          : []),
      ];
      const links: { caseId: number }[] = await db.repositoryCaseIssue.findMany(
        {
          where: { issueId: { in: issueIds } },
          orderBy: { caseId: "asc" },
          select: { caseId: true },
        }
      );
      const label = `${issue.key}: ${issue.title}`;
      const ruleLine = await describeCreateRunRule(db, {
        trigger: rule.trigger,
        statuses:
          rule.trigger === "ISSUE_STATUS_ENTERED" && issue.status
            ? [issue.status]
            : undefined,
        autoExecute: options.autoExecute ?? null,
      });
      const composed = await composeRunFromCases(db, {
        projectId: job.projectId,
        name: label,
        caseIds: links.map((link) => link.caseId),
        links: [
          { label, url: issue.url },
          ...(ruleLine ? [{ label: ruleLine, url: null }] : []),
        ],
        issueIds: [issue.issueId],
        createdById: actorId,
        tenantId: job.tenantId,
      });
      if (!composed.created) {
        if (composed.reason === "no_cases") {
          deliveryNote ??= "ignored:no_cases";
        } else {
          deliveryError ??= `run:${composed.reason}`;
        }
        await log(rule, { outcome: composed.reason });
        continue;
      }
      runIds.push(composed.testRunId);
      await log(rule, {
        outcome: "run_created",
        testRunId: composed.testRunId,
        caseCount: composed.caseCount,
      });
      if (options.autoExecute) {
        const executed = await executeAutoRun(db, {
          autoExecute: options.autoExecute,
          testRunId: composed.testRunId,
          projectId: job.projectId,
          tenantId: job.tenantId,
        });
        if (!executed.requested) {
          deliveryError ??= `execute:${executed.code.toLowerCase()}`;
          await log(rule, {
            outcome: "execute_failed",
            testRunId: composed.testRunId,
            detail: executed.code,
          });
        }
      }
    } catch (error) {
      console.error(
        `[webhook-actions] rule ${rule.id} for issue ${issue.key} failed:`,
        error
      );
      deliveryError ??= "run:error";
      await log(rule, {
        outcome: "error",
        detail: error instanceof Error ? error.message : "failed",
      });
    }
  }

  const note = deliveryError ?? deliveryNote;
  if (runIds.length > 0 || note) {
    await annotate({
      ...(runIds.length > 0 ? { subjectRef: `run:${runIds[0]}` } : {}),
      error: note,
    });
  }
  return { outcome: "done", issueId: issue.issueId, runIds };
}

/** Whether a tracker webhook has rules worth handing to the worker. */
export async function hasTrackerRules(
  db: any,
  webhookConfigId: string
): Promise<boolean> {
  const count = await db.webhookAction.count({
    where: {
      webhookConfigId,
      isEnabled: true,
      trigger: { in: [...TRACKER_TRIGGERS] },
      action: { in: ["IMPORT_ISSUE", "CREATE_RUN"] },
    },
  });
  return count > 0;
}
