import type { DbClient } from "~/lib/zenstack";
import {
  qaseCaseStatuses,
  qaseResultStatuses,
  qaseSourceFields,
  qaseTrackerTitle,
} from "./content";
import { isQaseStorageConfigured } from "./files";
import {
  QASE_DEFECT_TRACKER,
  type QaseAnalysis,
  type QaseSourceUser,
} from "./mapping";
import type { QaseProjectSummary } from "./types";

type QaseRecord = Record<string, unknown>;

/** The status scope a test run result's status must have. */
export const QASE_RUN_STATUS_SCOPE = "Test Run";

export async function loadQaseStaged(
  db: DbClient,
  jobId: string,
  entity: string,
  projectCode?: string
): Promise<QaseRecord[]> {
  const rows = await db.qaseImportStaging.findMany({
    where: {
      jobId,
      entity,
      ...(projectCode === undefined ? {} : { projectCode }),
    },
    orderBy: { rowIndex: "asc" },
    select: { data: true },
  });
  return rows.map((row) => row.data as QaseRecord);
}

/** The tracker types of the issues linked to the staged cases and runs. */
async function loadExternalTrackerTypes(
  db: DbClient,
  jobId: string
): Promise<string[]> {
  const rows = await db.$queryRaw<{ type: string | null }[]>`
    SELECT DISTINCT linked ->> 'type' AS type
    FROM "QaseImportStaging" staged
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(staged."data" -> 'external_issues') = 'array'
        THEN staged."data" -> 'external_issues'
        ELSE '[]'::jsonb
      END
    ) AS linked
    WHERE staged."jobId" = ${jobId} AND staged."entity" = 'case'
    UNION
    SELECT DISTINCT staged."data" -> 'external_issue' ->> 'type' AS type
    FROM "QaseImportStaging" staged
    WHERE staged."jobId" = ${jobId}
      AND staged."entity" = 'run'
      AND jsonb_typeof(staged."data" -> 'external_issue') = 'object'
  `;
  return rows
    .map((row) => (row.type ?? "").trim())
    .filter(Boolean)
    .sort();
}

/**
 * What the mapping screen offers: the Qase records that need a destination and
 * the TestPlanIt records they can be mapped to.
 */
export async function buildQaseAnalysis(
  db: DbClient,
  job: { id: string; projects: unknown }
): Promise<QaseAnalysis> {
  const projects = Array.isArray(job.projects)
    ? (job.projects as unknown as QaseProjectSummary[])
    : [];
  const projectCodes = projects.map((project) => project.code);

  const [
    stagedUsers,
    systemFields,
    customFields,
    existingProjects,
    existingUsers,
    workflows,
    templates,
    caseFields,
    roles,
    statuses,
    runStates,
    milestoneTypes,
    runCount,
    resultCount,
    milestoneCount,
    defectCount,
    trackerTypes,
    integrations,
  ] = await Promise.all([
    loadQaseStaged(db, job.id, "user"),
    loadQaseStaged(db, job.id, "system_field"),
    loadQaseStaged(db, job.id, "custom_field"),
    db.projects.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isDeleted: false, isActive: true, isApi: false },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.workflows.findMany({
      where: { isDeleted: false, isEnabled: true, scope: "CASES" },
      select: {
        id: true,
        name: true,
        isDefault: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
      orderBy: { order: "asc" },
    }),
    db.templates.findMany({
      where: { isDeleted: false, isEnabled: true },
      select: { id: true, templateName: true },
      orderBy: { templateName: "asc" },
    }),
    db.caseFields.findMany({
      where: { isDeleted: false, isEnabled: true },
      select: {
        id: true,
        displayName: true,
        systemName: true,
        type: { select: { type: true } },
        fieldOptions: {
          select: {
            fieldOption: { select: { id: true, name: true, isDeleted: true } },
          },
        },
      },
      orderBy: { displayName: "asc" },
    }),
    db.roles.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, isDefault: true },
      orderBy: { name: "asc" },
    }),
    db.status.findMany({
      where: {
        isDeleted: false,
        isEnabled: true,
        scope: { some: { scope: { name: QASE_RUN_STATUS_SCOPE } } },
      },
      select: {
        id: true,
        name: true,
        systemName: true,
        color: { select: { value: true } },
      },
      orderBy: { order: "asc" },
    }),
    db.workflows.findMany({
      where: { isDeleted: false, isEnabled: true, scope: "RUNS" },
      select: {
        id: true,
        name: true,
        workflowType: true,
        isDefault: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
      orderBy: { order: "asc" },
    }),
    db.milestoneTypes.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        isDefault: true,
        icon: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.qaseImportStaging.count({ where: { jobId: job.id, entity: "run" } }),
    db.qaseImportStaging.count({ where: { jobId: job.id, entity: "result" } }),
    db.qaseImportStaging.count({
      where: { jobId: job.id, entity: "milestone" },
    }),
    db.qaseImportStaging.count({ where: { jobId: job.id, entity: "defect" } }),
    loadExternalTrackerTypes(db, job.id),
    db.integration.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, provider: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const users: QaseSourceUser[] = stagedUsers
    .filter((user) => user.id !== undefined && user.id !== null)
    .map((user) => ({
      id: String(user.id),
      name: typeof user.name === "string" ? user.name : "",
      email: typeof user.email === "string" ? user.email : "",
    }));

  return {
    source: {
      projects,
      users,
      caseStatuses: qaseCaseStatuses(systemFields),
      fields: qaseSourceFields(systemFields, customFields, projectCodes),
      resultStatuses: resultCount > 0 ? qaseResultStatuses(systemFields) : [],
      hasRuns: runCount > 0,
      hasMilestones: milestoneCount > 0,
      issueTrackers: [
        ...(defectCount > 0
          ? [{ id: QASE_DEFECT_TRACKER, title: "Qase" }]
          : []),
        ...trackerTypes
          .filter((type) => type !== QASE_DEFECT_TRACKER)
          .map((type) => ({ id: type, title: qaseTrackerTitle(type) })),
      ],
    },
    existing: {
      projects: existingProjects,
      users: existingUsers.map((user) => ({
        id: user.id,
        name: user.name ?? "",
        email: user.email ?? "",
      })),
      workflows,
      templates: templates.map((template) => ({
        id: template.id,
        name: template.templateName,
      })),
      caseFields: caseFields.map((field) => ({
        id: field.id,
        displayName: field.displayName,
        systemName: field.systemName,
        type: field.type.type,
        options: field.fieldOptions
          .map((assignment) => assignment.fieldOption)
          .filter((option) => !option.isDeleted)
          .map((option) => ({ id: option.id, name: option.name })),
      })),
      roles,
      statuses,
      runStates,
      milestoneTypes,
      integrations,
    },
    storageConfigured: isQaseStorageConfigured(),
  };
}
