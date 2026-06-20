/**
 * Server-side resolution helpers for the Jira panel's "Generate Test Cases"
 * flow. These reproduce, against the raw Prisma client, the project/template/
 * workflow lookups the in-app wizard performs via ZenStack hooks — so the
 * Forge panel (which has no session and can't use those hooks) reaches the
 * same target context before calling the shared generation + persistence
 * cores.
 */

import { prisma as db } from "@/lib/prisma";
import { IntegrationProvider, WorkflowScope } from "~/zenstack/models";
import type { TemplateData } from "@/api/llm/generate-test-cases/shared";

/** Folder the panel drops generated cases into (created on first use). */
export const GENERATED_FOLDER_NAME = "Generated from Jira";

export interface GenerationProject {
  id: number;
  name: string;
  /** True when this project maps to the issue's Jira project (default pick). */
  isDefaultForIssue: boolean;
}

/**
 * The TestPlanIt projects this Jira integration is connected to (active
 * `ProjectIntegration` rows). When `issueProjectKey` is supplied, the project
 * whose `IntegrationProject` mapping matches it is flagged as the default —
 * sorted first, then the rest alphabetically.
 */
export async function listGenerationProjects(
  integrationId: number,
  issueProjectKey?: string | null
): Promise<GenerationProject[]> {
  const projectIntegrations = await db.projectIntegration.findMany({
    where: {
      integrationId,
      isActive: true,
      project: { isDeleted: false },
    },
    select: {
      project: { select: { id: true, name: true } },
      integrationProjects: {
        select: { externalProjectKey: true, isDefault: true },
      },
    },
  });

  const key = issueProjectKey?.trim().toUpperCase() || null;

  const projects: GenerationProject[] = projectIntegrations.map((pi) => {
    const matchesIssue =
      key != null &&
      pi.integrationProjects.some(
        (ip) => ip.externalProjectKey?.toUpperCase() === key
      );
    return {
      id: pi.project.id,
      name: pi.project.name,
      isDefaultForIssue: matchesIssue,
    };
  });

  return projects.sort((a, b) => {
    if (a.isDefaultForIssue !== b.isDefaultForIssue) {
      return a.isDefaultForIssue ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface TemplateOption {
  id: number;
  name: string;
  isDefault: boolean;
}

/** Templates assigned to the project (the wizard's template picker source). */
export async function listProjectTemplates(
  projectId: number
): Promise<TemplateOption[]> {
  const templates = await db.templates.findMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId } },
    },
    select: { id: true, templateName: true, isDefault: true },
    orderBy: { templateName: "asc" },
  });
  return templates.map((t) => ({
    id: t.id,
    name: t.templateName,
    isDefault: t.isDefault,
  }));
}

export interface ProjectReadiness {
  hasRepository: boolean;
  hasDefaultWorkflow: boolean;
  hasActiveLlm: boolean;
}

/**
 * Whether a project can actually run generation: it needs a repository, a
 * default CASES workflow state, and a reachable LLM integration. The panel
 * uses this to fail fast with a clear message instead of generating and then
 * failing at save time.
 */
export async function getProjectReadiness(
  projectId: number
): Promise<ProjectReadiness> {
  const [repository, defaultWorkflow, projectLlmCount, globalLlmCount] =
    await Promise.all([
      db.repositories.findFirst({
        where: { projectId, isDeleted: false },
        select: { id: true },
      }),
      db.workflows.findFirst({
        where: {
          projects: { some: { projectId } },
          isDefault: true,
          isEnabled: true,
          isDeleted: false,
          scope: WorkflowScope.CASES,
        },
        select: { id: true },
      }),
      db.projectLlmIntegration.count({
        where: {
          projectId,
          isActive: true,
          llmIntegration: { status: "ACTIVE", isDeleted: false },
        },
      }),
      db.llmIntegration.count({
        where: { status: "ACTIVE", isDeleted: false },
      }),
    ]);

  return {
    hasRepository: !!repository,
    hasDefaultWorkflow: !!defaultWorkflow,
    // A project-scoped integration OR any active global integration can serve
    // generation (the resolver's 3-tier chain falls back to global). The
    // generate core re-resolves authoritatively and errors if none applies.
    hasActiveLlm: projectLlmCount > 0 || globalLlmCount > 0,
  };
}

/**
 * Whether `templateId` is assigned to `projectId`. The panel only offers
 * project-assigned templates, but a crafted request must still be rejected —
 * the picker is convenience, not the authority.
 */
export async function templateBelongsToProject(
  templateId: number,
  projectId: number
): Promise<boolean> {
  const assignment = await db.templateProjectAssignment.findUnique({
    where: { templateId_projectId: { templateId, projectId } },
    select: { templateId: true },
  });
  return !!assignment;
}

export interface FieldMapping {
  fieldName: string;
  caseFieldId: number;
  fieldType: string;
  fieldOptions?: { id: number; name: string }[];
}

/**
 * Build the `TemplateData` consumed by the generation prompt plus the
 * `fieldMappings` consumed by the persistence core — mirrors the wizard's
 * client-side derivation from a template's case fields. Returns null when the
 * template doesn't exist / isn't usable.
 */
export async function loadTemplateData(
  templateId: number
): Promise<{ template: TemplateData; fieldMappings: FieldMapping[] } | null> {
  const template = await db.templates.findFirst({
    where: { id: templateId, isDeleted: false },
    select: {
      id: true,
      templateName: true,
      caseFields: {
        orderBy: { order: "asc" },
        select: {
          caseFieldId: true,
          caseField: {
            select: {
              displayName: true,
              isRequired: true,
              type: { select: { type: true } },
              fieldOptions: {
                orderBy: { fieldOption: { order: "asc" } },
                select: {
                  fieldOption: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!template) return null;

  const fields = template.caseFields.map((cf) => {
    const options = cf.caseField.fieldOptions.map((fo) => fo.fieldOption.name);
    return {
      id: cf.caseFieldId,
      name: cf.caseField.displayName,
      type: cf.caseField.type.type,
      required: cf.caseField.isRequired,
      ...(options.length > 0 ? { options } : {}),
    };
  });

  const fieldMappings: FieldMapping[] = template.caseFields
    .filter(
      (cf) =>
        cf.caseField.displayName !== "Steps" &&
        !cf.caseField.displayName.toLowerCase().includes("steps")
    )
    .map((cf) => ({
      fieldName: cf.caseField.displayName,
      caseFieldId: cf.caseFieldId,
      fieldType: cf.caseField.type.type,
      fieldOptions: cf.caseField.fieldOptions.map((fo) => ({
        id: fo.fieldOption.id,
        name: fo.fieldOption.name,
      })),
    }));

  return {
    template: {
      id: template.id,
      name: template.templateName,
      fields,
    },
    fieldMappings,
  };
}

export interface FolderOption {
  id: number;
  name: string;
  parentId: number | null;
}

/** All folders in the project, for the panel's (hierarchical) folder picker. */
export async function listProjectFolders(
  projectId: number
): Promise<FolderOption[]> {
  return db.repositoryFolders.findMany({
    where: { projectId, isDeleted: false },
    orderBy: [{ parentId: "asc" }, { order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
}

/**
 * Best-guess destination folder for an issue: the folder of the first test
 * case already linked to that issue within the project. Lets the panel
 * pre-select "the folder these cases already live in". Returns null when the
 * issue has no linked cases in the project.
 */
export async function suggestFolderForIssue(
  projectId: number,
  issue: { issueKey?: string | null; issueId?: string | null }
): Promise<number | null> {
  const issueKey = issue.issueKey || undefined;
  const issueId = issue.issueId || undefined;
  if (!issueKey && !issueId) return null;

  const linkedCase = await db.repositoryCases.findFirst({
    where: {
      projectId,
      isDeleted: false,
      isArchived: false,
      issues: {
        some: {
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
    orderBy: { order: "asc" },
    select: { folderId: true },
  });
  return linkedCase?.folderId ?? null;
}

export interface ImportTarget {
  projectName: string;
  repositoryId: number;
  folderId: number;
  folderName: string;
  stateId: number;
  stateName: string;
  maxOrder: number;
}

/**
 * Resolve everything the persistence core needs to drop generated cases into a
 * project from the panel. Folder precedence: a valid `folderId` (existing
 * folder picked in the panel) → else a `newFolderName` top-level folder created
 * after the Jira ticket → else the dedicated "Generated from Jira" safety-net
 * folder. Returns null when the project has no repository or no default CASES
 * workflow.
 */
export async function resolveImportTarget(
  projectId: number,
  authorUserId: string,
  options: { folderId?: number | null; newFolderName?: string | null } = {}
): Promise<ImportTarget | null> {
  const project = await db.projects.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true, name: true },
  });
  if (!project) return null;

  const workflow = await db.workflows.findFirst({
    where: {
      projects: { some: { projectId } },
      isDefault: true,
      isEnabled: true,
      isDeleted: false,
      scope: WorkflowScope.CASES,
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
  if (!workflow) return null;

  // Destination folder: the picker's selection (validated against the project),
  // else the dedicated "Generated from Jira" root folder as a safety net.
  let folder: { id: number; name: string; repositoryId: number } | null = null;

  if (options.folderId != null) {
    folder = await db.repositoryFolders.findFirst({
      where: { id: options.folderId, projectId, isDeleted: false },
      select: { id: true, name: true, repositoryId: true },
    });
  }

  if (!folder) {
    const repository = await db.repositories.findFirst({
      where: { projectId, isDeleted: false },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!repository) return null;

    // A requested new folder (named after the Jira ticket) is created at the
    // repository root; otherwise fall back to the dedicated "Generated from
    // Jira" folder. Both find-or-create at parentId null — Postgres treats
    // null parentId as distinct, so match with findFirst not the compound unique.
    const targetName = options.newFolderName?.trim() || GENERATED_FOLDER_NAME;
    folder =
      (await db.repositoryFolders.findFirst({
        where: {
          projectId,
          repositoryId: repository.id,
          parentId: null,
          name: targetName,
          isDeleted: false,
        },
        select: { id: true, name: true, repositoryId: true },
      })) ??
      (await db.repositoryFolders.create({
        data: {
          name: targetName,
          projectId,
          repositoryId: repository.id,
          creatorId: authorUserId,
          order: 0,
        },
        select: { id: true, name: true, repositoryId: true },
      }));
  }

  const maxOrderRow = await db.repositoryCases.findFirst({
    where: {
      projectId,
      folderId: folder.id,
      isDeleted: false,
      isArchived: false,
    },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return {
    projectName: project.name,
    repositoryId: folder.repositoryId,
    folderId: folder.id,
    folderName: folder.name,
    stateId: workflow.id,
    stateName: workflow.name,
    maxOrder: maxOrderRow?.order ?? 0,
  };
}
