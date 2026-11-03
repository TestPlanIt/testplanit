import { randomUUID } from "node:crypto";
import { getUserWithRole } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { issueInProjectWhere } from "~/lib/issues/projectMembershipWhere";
import { savedCaseDraftKey, toCaseDraftColumn } from "~/lib/services/caseDraft";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";
import {
  buildStagedCaseDraft,
  StageInputSchema,
  uniqueTagNames,
  type StageInput,
  type StageResult,
  type StagingTemplateField,
} from "~/lib/services/stagedCaseFromGenerated";
import { getAuthDb } from "~/lib/zenstack";

/**
 * Stage generated test cases: one staged case (a saved CaseDraft) per
 * generated case, in the author's name, in the wizard's folder. The staged
 * cases are created later from My Staged Cases, where they get their id,
 * version, and audit entry; nothing is added to the repository here.
 *
 * Writes go through the author's policy client, so the CaseDraft policy
 * decides whether they may add cases to the project. Tags and the source
 * issue are resolved the way the import resolves them, so a staged case
 * created later carries the same tags and issue link an imported one would.
 */
export async function stageGeneratedTestCasesForUser(
  input: StageInput,
  userId: string
): Promise<StageResult> {
  const failure = (message: string): StageResult => ({
    status: "error",
    message,
    stagedCount: 0,
    stagedIds: [],
    errors: [],
  });

  // Server actions restore NaN / Infinity from the wire; the JSON column takes neither.
  const parsed = StageInputSchema.safeParse(JSON.parse(JSON.stringify(input)));
  if (!parsed.success) {
    return {
      ...failure("Invalid input data"),
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`
      ),
    };
  }
  const data = parsed.data;

  const user = await getUserWithRole(userId);
  if (!user) return failure("User not found");
  const db = await getAuthDb(user);

  const folder = await db.repositoryFolders.findFirst({
    where: { id: data.folderId, projectId: data.projectId, isDeleted: false },
    select: { id: true },
  });
  if (!folder) return failure("Folder not found");

  const template = await db.templates.findFirst({
    where: {
      id: data.templateId,
      isDeleted: false,
      projects: { some: { projectId: data.projectId } },
    },
    select: {
      id: true,
      caseFields: {
        where: { caseField: { isEnabled: true, isDeleted: false } },
        orderBy: { order: "asc" },
        select: {
          caseFieldId: true,
          caseField: {
            select: {
              id: true,
              displayName: true,
              isRequired: true,
              isChecked: true,
              defaultValue: true,
              type: { select: { type: true } },
              fieldOptions: {
                where: { fieldOption: { isEnabled: true, isDeleted: false } },
                orderBy: { fieldOption: { order: "asc" } },
                select: {
                  fieldOption: {
                    select: { id: true, name: true, isDefault: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!template) return failure("Template not found");

  const workflow = await db.workflows.findFirst({
    where: { id: data.stateId, isDeleted: false },
    select: { id: true },
  });
  if (!workflow) return failure("Workflow not found");

  // Tags are upserted up front, as the import does, so every staged case
  // that names one points at the same row.
  const tagIdByName = new Map<string, number>();
  if (data.autoGenerateTags) {
    for (const name of uniqueTagNames(data.testCases)) {
      const tag = await db.tags.upsert({
        where: { name },
        create: { name, isDeleted: false },
        update: {},
        select: { id: true },
      });
      tagIdByName.set(name, tag.id);
    }
  }

  // The source issue, linked by id in the staged case's extras. An external
  // issue is upserted through the reviewed shell writer (the same path the
  // import takes); an internal one is looked up project-scoped so a crafted
  // id cannot reach another project's issue, and left unlinked if missing.
  let issueIds: number[] = [];
  if (data.issue) {
    const shell = await upsertLinkedIssueShell(baseDb, {
      externalId: data.issue.externalId,
      integrationId: data.issue.integrationId,
      create: {
        name: data.issue.issueKey,
        title: data.issue.title,
        description: data.issue.description || "",
        externalKey: data.issue.issueKey,
        externalId: data.issue.externalId,
        externalUrl: data.issue.externalUrl,
        projectId: data.projectId,
        integrationId: data.issue.integrationId,
        createdById: userId,
      },
      update: {
        title: data.issue.title,
        externalKey: data.issue.issueKey,
        externalUrl: data.issue.externalUrl,
      },
      select: { id: true },
    });
    issueIds = [shell.id];
  } else if (data.linkIssueId) {
    const issue = await db.issue.findFirst({
      where: {
        id: data.linkIssueId,
        isDeleted: false,
        ...issueInProjectWhere(data.projectId),
      },
      select: { id: true },
    });
    if (issue) issueIds = [issue.id];
  }

  const fields = template.caseFields as unknown as StagingTemplateField[];
  const stagedIds: string[] = [];
  const errors: string[] = [];

  for (const testCase of data.testCases) {
    try {
      const tagIds = (testCase.tags ?? [])
        .map((t) => tagIdByName.get(t.trim()))
        .filter((id): id is number => id != null);
      const draft = buildStagedCaseDraft(testCase, {
        templateId: template.id,
        workflowId: workflow.id,
        fields,
        fieldMappings: data.fieldMappings,
        tagIds: [...new Set(tagIds)],
        issueIds,
      });
      const id = randomUUID();
      await db.caseDraft.create({
        data: {
          id,
          draftKey: savedCaseDraftKey(id),
          isSaved: true,
          name: draft.name,
          rowCount: 1,
          problemCount: draft.problemCount,
          project: { connect: { id: data.projectId } },
          user: { connect: { id: userId } },
          folder: { connect: { id: folder.id } },
          payload: toCaseDraftColumn(draft.payload),
        },
      });
      stagedIds.push(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to stage "${testCase.name}": ${message}`);
    }
  }

  return {
    status: stagedIds.length > 0 || errors.length === 0 ? "success" : "error",
    message:
      stagedIds.length === 0 && errors.length > 0
        ? "No test cases were staged"
        : undefined,
    stagedCount: stagedIds.length,
    stagedIds,
    errors,
  };
}
