import type { JsonObject } from "@zenstackhq/orm";
import type { TxClient } from "~/lib/zenstack";
import {
  IntegrationAuthType,
  IntegrationProvider,
  IntegrationStatus,
} from "~/zenstack/models";
import { loadQaseStaged } from "./analysis";
import {
  qaseDefectDescription,
  qaseExternalIssues,
  toQaseFiles,
  type QaseExternalIssue,
} from "./content";
import {
  QaseImportCanceledError,
  asText,
  copyAttachments,
  loadMappings,
  persist,
  remember,
  toDate,
  warn,
  type ImportState,
  type ProjectContext,
} from "./importContext";
import { QASE_DEFECT_TRACKER, qaseTrackerProvider } from "./mapping";
import { userFor } from "./runQaseExecution";

type QaseRecord = Record<string, unknown>;

const skipAudit = (tx: TxClient) =>
  tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;

/**
 * Resolves each source of Qase issues to an integration, creating the ones
 * the mapping asks for. An integration of the same name is used instead of a
 * second one being made. A created integration has no connection details:
 * it holds the imported issues until an administrator sets it up.
 */
export async function prepareIssueTrackers(state: ImportState): Promise<void> {
  const { db, jobId, config, analysis } = state;
  const known = await loadMappings(db, jobId, "issue_tracker");
  for (const tracker of analysis.source.issueTrackers) {
    const mapping = config.issueTrackers[tracker.id];
    if (!mapping) {
      continue;
    }
    const knownId = known.get(tracker.id);
    if (knownId || mapping.action === "map") {
      const id = knownId ? Number(knownId) : mapping.mappedTo;
      if (id) {
        state.trackers.set(tracker.id, id);
      }
      continue;
    }
    const id = await db.$transaction(async (tx) => {
      await skipAudit(tx);
      // The name is unique among deleted integrations too.
      const sameNamed = await tx.integration.findFirst({
        where: { name: { equals: mapping.name, mode: "insensitive" } },
        select: { id: true, isDeleted: true },
      });
      if (sameNamed?.isDeleted) {
        await tx.integration.update({
          where: { id: sameNamed.id },
          data: { isDeleted: false, deletedAt: null, deletedById: null },
        });
      }
      const integrationId =
        sameNamed?.id ??
        (
          await tx.integration.create({
            data: {
              name: mapping.name,
              provider: qaseTrackerProvider(tracker.id) as IntegrationProvider,
              authType: IntegrationAuthType.NONE,
              status: IntegrationStatus.INACTIVE,
              credentials: {},
              settings: { importedFrom: "qase", qaseTracker: tracker.id },
            },
            select: { id: true },
          })
        ).id;
      await remember(tx, jobId, "issue_tracker", "", tracker.id, integrationId);
      return integrationId;
    });
    state.trackers.set(tracker.id, id);
  }
}

/** The link a defect has to an issue in another tracker, when Qase kept one. */
function defectExternalUrl(defect: QaseRecord): string | null {
  let data: unknown = defect.external_data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as QaseRecord;
  const link = asText(record.link) || asText(record.url);
  return /^https?:\/\//i.test(link) ? link : null;
}

/**
 * The issues of one Qase project: its defects, and the tracker issues linked
 * to its cases and runs. Runs after the cases, runs and results they point to.
 */
export async function importIssues(
  state: ImportState,
  project: ProjectContext,
  cases: QaseRecord[]
): Promise<void> {
  const { db, jobId } = state;
  const defects = await loadQaseStaged(db, jobId, "defect", project.code);
  const runs = await loadQaseStaged(db, jobId, "run", project.code);
  const caseLinks = cases.flatMap((record) =>
    qaseExternalIssues(record).map((issue) => ({ record, issue }))
  );
  const runLinks = runs.flatMap((record) =>
    qaseExternalIssues(record).map((issue) => ({ record, issue }))
  );
  if (defects.length + caseLinks.length + runLinks.length === 0) {
    return;
  }

  const targets = async (entity: string) => {
    const ids = new Map<string, number>();
    for (const [sourceId, targetId] of await loadMappings(
      db,
      jobId,
      entity,
      project.code
    )) {
      ids.set(sourceId, Number(targetId));
    }
    return ids;
  };
  const [caseIds, runIds, resultIds, milestoneIds, doneDefects] =
    await Promise.all([
      targets("case"),
      targets("run"),
      targets("result"),
      targets("milestone"),
      targets("defect"),
    ]);

  // The project is given each integration its issues belong to. A project
  // has one active integration, so one it already has stays the active one.
  const assigned = new Set<number>();
  const assignIntegration = async (tx: TxClient, integrationId: number) => {
    if (assigned.has(integrationId)) {
      return;
    }
    const existing = await tx.projectIntegration.findFirst({
      where: { projectId: project.projectId, integrationId },
      select: { id: true },
    });
    if (!existing) {
      const active = await tx.projectIntegration.findFirst({
        where: { projectId: project.projectId, isActive: true },
        select: { id: true },
      });
      await tx.projectIntegration.create({
        data: {
          projectId: project.projectId,
          integrationId,
          isActive: !active,
        },
      });
    }
    assigned.add(integrationId);
  };
  const reach = async (tx: TxClient, issueId: number) => {
    await tx.issueProjectMembership.createMany({
      data: [{ issueId, projectId: project.projectId }],
      skipDuplicates: true,
    });
  };

  const defectTracker = state.trackers.get(QASE_DEFECT_TRACKER);
  for (const defect of defectTracker ? defects : []) {
    const sourceId = String(defect.id);
    if (doneDefects.has(sourceId)) {
      continue;
    }
    const key = `${project.code}-D${sourceId}`.slice(0, 255);
    const title = asText(defect.title).trim() || key;
    try {
      const listed = Array.isArray(defect.attachments)
        ? (defect.attachments as QaseRecord[])
        : [];
      for (const attachment of listed) {
        if (!asText(attachment?.url)) {
          warn(state, {
            code: "attachment_failed",
            subject: `${title}: ${asText(attachment?.hash) || "attachment"}`,
          });
        }
      }
      const files = await copyAttachments(state, toQaseFiles(listed), title);
      const createdById = userFor(
        state,
        state.authorUsers.get(asText(defect.author_uuid))
      );
      await db.$transaction(async (tx) => {
        await skipAudit(tx);
        await assignIntegration(tx, defectTracker!);
        const existing = await tx.issue.findFirst({
          where: { integrationId: defectTracker!, externalId: key },
          select: { id: true },
        });
        const issueId =
          existing?.id ??
          (
            await tx.issue.create({
              data: {
                name: key,
                title,
                description:
                  qaseDefectDescription(defect, state.customFields) || null,
                status: asText(defect.status) || null,
                priority: asText(defect.severity) || null,
                externalId: key,
                externalKey: key,
                externalUrl: defectExternalUrl(defect),
                integrationId: defectTracker!,
                projectId: project.projectId,
                createdById,
                createdAt: toDate(defect.created_at) ?? new Date(),
                data: {
                  importedFrom: "qase",
                  qaseProject: project.code,
                  qaseDefectId: sourceId,
                } as JsonObject,
              },
              select: { id: true },
            })
          ).id;
        await reach(tx, issueId);
        if (!existing && files.length > 0) {
          await tx.attachments.createMany({
            data: files.map(({ file, copied }) => ({
              issueId,
              url: copied.url,
              name: file.filename.slice(0, 255) || "attachment",
              note: "",
              mimeType: copied.mime,
              size: BigInt(copied.size),
              createdById,
            })),
          });
        }
        const milestoneId = milestoneIds.get(String(defect.milestone_id));
        if (milestoneId) {
          await tx.milestoneIssue.createMany({
            data: [{ milestoneId, issueId }],
            skipDuplicates: true,
          });
        }
        for (const run of Array.isArray(defect.runs) ? defect.runs : []) {
          const runId = runIds.get(String(run));
          if (runId) {
            await tx.testRuns.update({
              where: { id: runId },
              data: { issues: { connect: { id: issueId } } },
            });
          }
        }
        for (const result of Array.isArray(defect.results)
          ? defect.results
          : []) {
          const resultId = resultIds.get(String(result));
          if (resultId) {
            await tx.testRunResults.update({
              where: { id: resultId },
              data: { issues: { connect: { id: issueId } } },
            });
          }
        }
        await remember(tx, jobId, "defect", project.code, sourceId, issueId);
      });
    } catch (error) {
      if (error instanceof QaseImportCanceledError) {
        throw error;
      }
      state.progress.issues.failed = (state.progress.issues.failed ?? 0) + 1;
      warn(state, {
        code: "issue_failed",
        subject: title,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    state.progress.issues.done += 1;
    await persist(state, "issues");
  }

  // An issue in another tracker is brought over as its key and link. One the
  // tracker's own sync already made is used, as the Testmo import does.
  const linkedIssueIds = new Map<string, number>();
  const linkedIssue = async (
    tx: TxClient,
    issue: QaseExternalIssue
  ): Promise<number | null> => {
    const integrationId = state.trackers.get(issue.type);
    if (!integrationId) {
      return null;
    }
    const cacheKey = `${integrationId}:${issue.id}`;
    let issueId = linkedIssueIds.get(cacheKey);
    if (!issueId) {
      await assignIntegration(tx, integrationId);
      const existing =
        (await tx.issue.findFirst({
          where: {
            externalKey: issue.id,
            integrationId,
            externalStatus: { not: null },
          },
          select: { id: true },
        })) ??
        (await tx.issue.findFirst({
          where: { externalKey: issue.id, integrationId },
          select: { id: true },
        }));
      issueId =
        existing?.id ??
        (
          await tx.issue.create({
            data: {
              name: issue.id,
              title: issue.id,
              status: null,
              priority: null,
              externalKey: issue.id,
              externalUrl: issue.link,
              integrationId,
              projectId: project.projectId,
              createdById: state.importerId,
              data: { importedFrom: "qase" } as JsonObject,
            },
            select: { id: true },
          })
        ).id;
      await reach(tx, issueId);
      linkedIssueIds.set(cacheKey, issueId);
    }
    return issueId;
  };

  const link = async (
    subject: string,
    issue: QaseExternalIssue,
    connect: (tx: TxClient, issueId: number) => Promise<unknown>
  ) => {
    try {
      await db.$transaction(async (tx) => {
        await skipAudit(tx);
        const issueId = await linkedIssue(tx, issue);
        if (issueId) {
          await connect(tx, issueId);
        }
      });
    } catch (error) {
      if (error instanceof QaseImportCanceledError) {
        throw error;
      }
      linkedIssueIds.delete(
        `${state.trackers.get(issue.type) ?? 0}:${issue.id}`
      );
      state.progress.issues.failed = (state.progress.issues.failed ?? 0) + 1;
      warn(state, {
        code: "issue_failed",
        subject: `${issue.id} (${subject})`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    state.progress.issues.done += 1;
    await persist(state, "issues");
  };

  for (const { record, issue } of caseLinks) {
    const caseId = caseIds.get(String(record.id));
    await link(
      asText(record.title) || String(record.id),
      issue,
      async (tx, issueId) => {
        if (caseId) {
          await tx.repositoryCaseIssue.createMany({
            data: [{ caseId, issueId }],
            skipDuplicates: true,
          });
        }
      }
    );
  }
  for (const { record, issue } of runLinks) {
    const runId = runIds.get(String(record.id));
    await link(
      asText(record.title) || String(record.id),
      issue,
      async (tx, issueId) => {
        if (runId) {
          await tx.testRuns.update({
            where: { id: runId },
            data: { issues: { connect: { id: issueId } } },
          });
        }
      }
    );
  }
}

/** How many issues and issue links a project's staged records hold. */
export function countQaseIssues(
  defects: number,
  cases: QaseRecord[],
  runs: QaseRecord[]
): number {
  return (
    defects +
    [...cases, ...runs].reduce(
      (sum, record) => sum + qaseExternalIssues(record).length,
      0
    )
  );
}
