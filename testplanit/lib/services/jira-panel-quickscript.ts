/**
 * Server-side resolvers for the Jira panel's "Generate QuickScript" flow —
 * the QuickScript counterpart to `jira-panel-generation.ts`. The Forge panel
 * has no session and can't use the in-app ZenStack hooks, so these reproduce
 * the export-template picker and the issue→linked-cases lookup against the raw
 * Prisma client before the shared generation service runs.
 */

import { baseDb as db } from "@/lib/db";
import { formatRecordKey, RECORD_TYPES } from "~/lib/recordKey";
import { readRecordKeyConfig } from "~/lib/services/recordKeyConfig";
import { IntegrationProvider } from "~/zenstack/models";

export interface QuickScriptTemplateOption {
  id: number;
  name: string;
  framework: string;
  language: string;
  fileExtension: string;
  /** Global default template. */
  isDefault: boolean;
  /** This project's configured default export template. */
  isProjectDefault: boolean;
}

/**
 * Export templates offered by the panel's picker for a project: its assigned
 * enabled templates, or every enabled template when the project has no
 * assignments (matches the in-app modal's default). The project's configured
 * default is flagged so the panel can pre-select it.
 */
export async function listProjectExportTemplates(
  projectId: number
): Promise<QuickScriptTemplateOption[]> {
  const assignments = await db.caseExportTemplateProjectAssignment.findMany({
    where: { projectId },
    select: { templateId: true },
  });
  const assignedIds = new Set(assignments.map((a) => a.templateId));

  const [templates, project] = await Promise.all([
    db.caseExportTemplate.findMany({
      where: {
        isDeleted: false,
        isEnabled: true,
        ...(assignedIds.size > 0 ? { id: { in: [...assignedIds] } } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        framework: true,
        language: true,
        fileExtension: true,
        isDefault: true,
      },
    }),
    db.projects.findUnique({
      where: { id: projectId },
      select: { defaultCaseExportTemplateId: true },
    }),
  ]);

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    framework: t.framework,
    language: t.language,
    fileExtension: t.fileExtension,
    isDefault: t.isDefault,
    isProjectDefault: t.id === project?.defaultCaseExportTemplateId,
  }));
}

export interface LinkedCaseOption {
  id: number;
  name: string;
  displayKey: string | null;
  folder: string;
  /** The project the case belongs to — a case lives in exactly one. */
  projectId: number;
}

/**
 * Test cases linked to the given Jira issue across `projectIds` — the source
 * set the panel offers for QuickScript generation. Matches on the issue's
 * external id, key, or name (mirrors `suggestFolderForIssue`).
 *
 * Takes a list of projects rather than one because a Jira project maps to many
 * TestPlanIt projects by design, so the caller can't know up front which one
 * holds the issue's cases — each returned case carries its `projectId` so the
 * caller can group. Returns an empty list when the issue has no linked cases in
 * any of them.
 */
export async function listIssueLinkedCases(
  projectIds: number[],
  issue: { issueKey?: string | null; issueId?: string | null }
): Promise<LinkedCaseOption[]> {
  const issueKey = issue.issueKey || undefined;
  const issueId = issue.issueId || undefined;
  if (!issueKey && !issueId) return [];
  if (projectIds.length === 0) return [];

  const cases = await db.repositoryCases.findMany({
    where: {
      projectId: { in: projectIds },
      isDeleted: false,
      isArchived: false,
      caseIssues: {
        some: {
          issue: {
            integration: { provider: IntegrationProvider.JIRA },
            OR: [
              ...(issueId ? [{ externalId: issueId }] : []),
              ...(issueKey
                ? [{ name: issueKey }, { externalKey: issueKey }]
                : []),
            ],
          },
        },
      },
    },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      projectId: true,
      folder: { select: { name: true } },
      project: { select: { key: true } },
    },
  });

  const { enabled: recordKeyEnabled, tokens: recordKeyTokens } =
    await readRecordKeyConfig(db);

  return cases.map((c) => ({
    id: c.id,
    name: c.name,
    displayKey: recordKeyEnabled
      ? formatRecordKey({
          projectKey: c.project?.key ?? null,
          type: RECORD_TYPES.TEST_CASE,
          id: c.id,
          tokens: recordKeyTokens,
        })
      : null,
    folder: c.folder?.name || "",
    projectId: c.projectId,
  }));
}

/**
 * Whether every requested case id is a non-deleted case in the project. The
 * panel only offers linked cases, but a crafted request must still be rejected.
 */
export async function casesBelongToProject(
  caseIds: number[],
  projectId: number
): Promise<boolean> {
  if (caseIds.length === 0) return false;
  const count = await db.repositoryCases.count({
    where: { id: { in: caseIds }, projectId, isDeleted: false },
  });
  return count === caseIds.length;
}
