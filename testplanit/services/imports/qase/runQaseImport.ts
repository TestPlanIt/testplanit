import type { JSONContent } from "@tiptap/core";
import type { JsonObject } from "@zenstackhq/orm";
import bcrypt from "bcrypt";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import type { DbClient } from "~/lib/zenstack";
import { generateRandomPassword } from "~/utils/randomPassword";
import { findOrCreateProjectRepository } from "~/workers/testmoImport/helpers";
import { buildQaseAnalysis, loadQaseStaged } from "./analysis";
import { importExecution, prepareResultStatuses } from "./runQaseExecution";
import {
  countQaseIssues,
  importIssues,
  prepareIssueTrackers,
} from "./runQaseIssues";
import {
  EMPTY_DOC,
  QaseImportCanceledError,
  asText,
  copyAttachments,
  copyImages,
  loadMappings,
  MAX_WARNINGS,
  persist,
  remember,
  resolveTag,
  toDate,
  warn,
  type ImportState,
  type ProjectContext,
} from "./importContext";
import {
  appendToDoc,
  buildQaseParameterSet,
  convertQaseFieldValue,
  flattenQaseSteps,
  isEmptyDoc,
  qaseCaseFieldRawValues,
  qaseResultStatusSlugs,
  qaseTextToDoc,
  stepTextToDoc,
  toQaseFiles,
  type QaseFile,
  type QaseFlatStep,
} from "./content";
import {
  QaseFileCopier,
  type QaseCopiedFile,
  type QaseFileCopierOptions,
} from "./files";
import {
  normalizeQaseMapping,
  unmappedQaseUser,
  validateQaseMapping,
} from "./mapping";
import type {
  QaseImportProgress,
  QaseImportWarning,
  QaseProjectSummary,
} from "./types";

type QaseRecord = Record<string, unknown>;

const TO_BE_AUTOMATED_TAG = "To be automated";

export { QaseImportCanceledError };

export interface RunQaseImportOptions {
  db: DbClient;
  jobId: string;
  /** Test seam for downloads and uploads. */
  copierOptions?: Partial<QaseFileCopierOptions>;
  /**
   * Called once the import has finished, with the projects it wrote to and
   * whether it created any of them.
   */
  onCompleted?: (
    projectIds: number[],
    createdProjects: boolean
  ) => Promise<void>;
}

function toSystemName(displayName: string, taken: Set<string>): string {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([^a-z])/, "f_$1") || "qase_field";
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    candidate = `${base}_${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Creates the projects the mapping asks for, set up like one made in the
 * project wizard with its defaults: every workflow state, status and milestone
 * type, and the default template.
 */
async function prepareProjects(state: ImportState): Promise<void> {
  const { db, jobId, config, analysis } = state;
  for (const source of analysis.source.projects) {
    const mapping = config.projects[source.code];
    if (mapping?.action !== "create") {
      continue;
    }
    const name = mapping.name;
    const projectId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const sameNamed = await tx.projects.findUnique({
        where: { name },
        select: { id: true, isDeleted: true },
      });
      if (sameNamed?.isDeleted) {
        throw new Error(
          `A deleted project is already named "${name}". Choose another name.`
        );
      }
      if (sameNamed) {
        await remember(tx, jobId, "project", "", source.code, sameNamed.id);
        return sameNamed.id;
      }
      const [workflows, statuses, milestoneTypes, defaultTemplate] =
        await Promise.all([
          tx.workflows.findMany({
            where: { isDeleted: false, isEnabled: true },
            select: { id: true },
          }),
          tx.status.findMany({
            where: { isDeleted: false, isEnabled: true },
            select: { id: true },
          }),
          tx.milestoneTypes.findMany({
            where: { isDeleted: false },
            select: { id: true },
          }),
          tx.templates.findFirst({
            where: { isDeleted: false, isEnabled: true, isDefault: true },
            select: { id: true },
          }),
        ]);
      const created = await tx.projects.create({
        data: {
          name,
          createdBy: state.importerId,
          ...(defaultTemplate ? { defaultTemplateId: defaultTemplate.id } : {}),
        },
        select: { id: true },
      });
      await tx.repositories.create({ data: { projectId: created.id } });
      await tx.projectWorkflowAssignment.createMany({
        data: workflows.map(({ id }) => ({
          workflowId: id,
          projectId: created.id,
        })),
      });
      await tx.projectStatusAssignment.createMany({
        data: statuses.map(({ id }) => ({
          statusId: id,
          projectId: created.id,
        })),
      });
      await tx.milestoneTypesAssignment.createMany({
        data: milestoneTypes.map(({ id }) => ({
          milestoneTypeId: id,
          projectId: created.id,
        })),
      });
      if (defaultTemplate) {
        await tx.templateProjectAssignment.create({
          data: { templateId: defaultTemplate.id, projectId: created.id },
        });
      }
      await remember(tx, jobId, "project", "", source.code, created.id);
      return created.id;
    });
    config.projects[source.code] = {
      action: "map",
      mappedTo: projectId,
      name: "",
    };
  }
}

/**
 * Creates the user accounts the mapping asks for. An address that already has
 * an account is mapped to it instead. A new account gets a random password,
 * so its owner signs in through a password reset or single sign-on.
 */
async function prepareUsers(state: ImportState): Promise<void> {
  const { db, jobId, config, analysis } = state;
  for (const source of analysis.source.users) {
    const mapping = config.users[source.id];
    if (mapping?.action !== "create") {
      continue;
    }
    const email = mapping.email;
    const name = mapping.name || email;
    const user = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
      });
      if (existing) {
        await remember(tx, jobId, "user", "", source.id, existing.id);
        return existing;
      }
      const role =
        mapping.roleId === null
          ? await tx.roles.findFirst({
              where: { isDefault: true, isDeleted: false },
              select: { id: true },
            })
          : await tx.roles.findFirst({
              where: { id: mapping.roleId, isDeleted: false },
              select: { id: true },
            });
      if (!role) {
        throw new Error(`The role chosen for ${email} does not exist.`);
      }
      const created = await tx.user.create({
        data: {
          name,
          email,
          password: await bcrypt.hash(generateRandomPassword(), 10),
          access: mapping.access,
          roleId: role.id,
          isActive: mapping.isActive,
          isApi: mapping.isApi,
          emailVerified: new Date(),
          createdById: state.importerId,
        },
        select: { id: true, name: true, email: true },
      });
      await remember(tx, jobId, "user", "", source.id, created.id);
      return created;
    });
    config.users[source.id] = { ...unmappedQaseUser(), mappedTo: user.id };
    state.userNames.set(user.id, user.name || user.email || "");
  }
}

/** Creates or resolves the template and the fields the cases are written to. */
async function prepareTemplate(state: ImportState): Promise<void> {
  const { db, jobId, config, analysis } = state;
  const known = await loadMappings(db, jobId, "field");
  const knownTemplate = (await loadMappings(db, jobId, "template")).get(
    "template"
  );

  await db.$transaction(async (tx) => {
    const types = await tx.caseFieldTypes.findMany({
      select: { id: true, type: true },
    });
    const typeId = (name: string) => {
      const match = types.find((type) => type.type === name);
      if (!match) {
        throw new Error(`Case field type "${name}" does not exist.`);
      }
      return match.id;
    };
    const systemNames = new Set(
      (await tx.caseFields.findMany({ select: { systemName: true } })).map(
        (field) => field.systemName
      )
    );
    const [icon, color] = await Promise.all([
      tx.fieldIcon.findFirst({ orderBy: { id: "asc" }, select: { id: true } }),
      tx.color.findFirst({ orderBy: { id: "asc" }, select: { id: true } }),
    ]);

    const fieldIds = new Map<string, number>();
    for (const source of analysis.source.fields) {
      const mapping = config.fields[source.key];
      if (!mapping || mapping.action === "skip") {
        continue;
      }
      if (mapping.action === "map" && mapping.mappedTo) {
        fieldIds.set(source.key, mapping.mappedTo);
        continue;
      }
      const earlier = known.get(source.key);
      if (earlier) {
        fieldIds.set(source.key, Number(earlier));
        continue;
      }
      const created = await tx.caseFields.create({
        data: {
          displayName: mapping.name,
          systemName: toSystemName(mapping.name, systemNames),
          typeId: typeId(source.targetType),
        },
        select: { id: true },
      });
      for (const [order, option] of source.options.entries()) {
        const fieldOption = await tx.fieldOptions.create({
          data: {
            name: option.title,
            order,
            iconId: icon?.id ?? null,
            iconColorId: color?.id ?? null,
          },
          select: { id: true },
        });
        await tx.caseFieldAssignment.create({
          data: { caseFieldId: created.id, fieldOptionId: fieldOption.id },
        });
      }
      await remember(tx, jobId, "field", "", source.key, created.id);
      fieldIds.set(source.key, created.id);
    }

    let templateId: number;
    if (config.template.action === "map" && config.template.mappedTo) {
      templateId = config.template.mappedTo;
    } else if (knownTemplate) {
      templateId = Number(knownTemplate);
    } else {
      const created = await tx.templates.create({
        data: {
          templateName: config.template.name,
          isEnabled: true,
          isDefault: false,
        },
        select: { id: true },
      });
      templateId = created.id;
      await remember(tx, jobId, "template", "", "template", templateId);
    }

    const assigned = await tx.templateCaseAssignment.findMany({
      where: { templateId },
      select: {
        caseFieldId: true,
        order: true,
        caseField: { select: { type: { select: { type: true } } } },
      },
    });
    const assignedIds = new Set(assigned.map((entry) => entry.caseFieldId));
    let nextOrder = assigned.reduce(
      (max, entry) => Math.max(max, entry.order),
      0
    );
    const assign = async (caseFieldId: number) => {
      if (assignedIds.has(caseFieldId)) {
        return;
      }
      assignedIds.add(caseFieldId);
      nextOrder += 1;
      await tx.templateCaseAssignment.create({
        data: { templateId, caseFieldId, order: nextOrder },
      });
    };
    for (const fieldId of fieldIds.values()) {
      await assign(fieldId);
    }
    if (!assigned.some((entry) => entry.caseField.type.type === "Steps")) {
      const stepsField =
        (await tx.caseFields.findFirst({
          where: { isDeleted: false, type: { type: "Steps" } },
          orderBy: { id: "asc" },
          select: { id: true },
        })) ??
        (await tx.caseFields.create({
          data: {
            displayName: "Steps",
            systemName: toSystemName("Steps", systemNames),
            typeId: typeId("Steps"),
          },
          select: { id: true },
        }));
      await assign(stepsField.id);
    }

    const targets = await tx.caseFields.findMany({
      where: { id: { in: [...fieldIds.values()] } },
      select: {
        id: true,
        fieldOptions: {
          select: {
            fieldOption: { select: { id: true, name: true, isDeleted: true } },
          },
        },
      },
    });
    state.templateId = templateId;
    state.fields = [];
    for (const source of analysis.source.fields) {
      const fieldId = fieldIds.get(source.key);
      const target = targets.find((candidate) => candidate.id === fieldId);
      if (!fieldId || !target) {
        continue;
      }
      state.fields.push({
        source,
        fieldId,
        target: {
          type: source.targetType,
          optionIds: new Map(
            target.fieldOptions
              .filter((entry) => !entry.fieldOption.isDeleted)
              .map((entry) => [
                entry.fieldOption.name.toLowerCase(),
                entry.fieldOption.id,
              ])
          ),
        },
      });
    }
  });
}

interface BuiltStep {
  sharedHash?: string;
  step: JSONContent;
  expectedResult: JSONContent;
}

/**
 * Editor documents for a list of flattened steps. Step images are placed in
 * the step; other step files are returned for the caller to attach.
 */
async function buildSteps(
  state: ImportState,
  flat: QaseFlatStep[],
  subject: string
): Promise<{ steps: BuiltStep[]; files: QaseFile[] }> {
  const texts = flat.flatMap((step) =>
    step.kind === "step" && !step.plain ? [step.action, step.expected] : []
  );
  const resolveImage = await copyImages(state, texts, subject);
  const steps: BuiltStep[] = [];
  const files: QaseFile[] = [];
  for (const entry of flat) {
    if (entry.kind === "shared") {
      steps.push({
        sharedHash: entry.hash,
        step: EMPTY_DOC,
        expectedResult: EMPTY_DOC,
      });
      continue;
    }
    let action = stepTextToDoc(entry.action, entry.plain, resolveImage);
    for (const file of entry.attachments) {
      if (!file.mime.startsWith("image/")) {
        files.push(file);
        continue;
      }
      state.progress.files.total += 1;
      const copied = await state.copier.copy(
        "docimage",
        file.url,
        file.filename,
        file.mime
      );
      if (copied) {
        state.progress.files.done += 1;
        action = appendToDoc(action, [
          {
            type: "image",
            attrs: { src: copied.url, alt: file.filename, align: "center" },
          },
        ]);
      } else {
        warn(state, {
          code: "image_failed",
          subject,
          detail: state.copier.failureOf("docimage", file.url),
        });
      }
    }
    steps.push({
      step: action,
      expectedResult: entry.expected.trim()
        ? stepTextToDoc(entry.expected, false, resolveImage)
        : EMPTY_DOC,
    });
  }
  return { steps, files };
}

async function importFolders(state: ImportState, project: ProjectContext) {
  const { db, jobId } = state;
  const suites = await loadQaseStaged(db, jobId, "suite", project.code);
  const done = await loadMappings(db, jobId, "suite", project.code);
  for (const [sourceId, targetId] of done) {
    project.folderIds.set(sourceId, Number(targetId));
  }

  const byParent = new Map<string, QaseRecord[]>();
  const ids = new Set(suites.map((suite) => String(suite.id)));
  for (const suite of suites) {
    const parent =
      suite.parent_id !== null &&
      suite.parent_id !== undefined &&
      ids.has(String(suite.parent_id))
        ? String(suite.parent_id)
        : "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), suite]);
  }

  const queue: string[] = [""];
  while (queue.length > 0) {
    const parentKey = queue.shift() as string;
    const children = [...(byParent.get(parentKey) ?? [])].sort(
      (a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)
    );
    for (const suite of children) {
      const sourceId = String(suite.id);
      queue.push(sourceId);
      if (project.folderIds.has(sourceId)) {
        continue;
      }
      const parentId = parentKey
        ? (project.folderIds.get(parentKey) ?? null)
        : null;
      const name = (asText(suite.title).trim() || `Suite ${sourceId}`).slice(
        0,
        255
      );
      const text = [asText(suite.description), asText(suite.preconditions)]
        .filter((part) => part.trim())
        .join("\n\n");
      const resolveImage = await copyImages(state, [text], name);
      const docs = qaseTextToDoc(text, resolveImage);

      const existing = await db.repositoryFolders.findFirst({
        where: {
          projectId: project.projectId,
          repositoryId: project.repositoryId,
          parentId,
          name,
          isDeleted: false,
        },
        select: { id: true },
      });
      const folderId =
        existing?.id ??
        (
          await db.repositoryFolders.create({
            data: {
              projectId: project.projectId,
              repositoryId: project.repositoryId,
              parentId,
              name,
              creatorId: state.importerId,
              order: Number(suite.position ?? 0) || 0,
              createdAt: toDate(suite.created_at),
              ...(isEmptyDoc(docs) ? {} : { docs: docs as JsonObject }),
            },
            select: { id: true },
          })
        ).id;
      await remember(db, jobId, "suite", project.code, sourceId, folderId);
      project.folderIds.set(sourceId, folderId);
      state.progress.folders.done += 1;
      await persist(state, "folders");
    }
  }
}

async function fallbackFolder(
  state: ImportState,
  project: ProjectContext
): Promise<number> {
  if (project.fallbackFolderId) {
    return project.fallbackFolderId;
  }
  const name = (project.title.trim() || project.code).slice(0, 255);
  const where = {
    projectId: project.projectId,
    repositoryId: project.repositoryId,
    parentId: null,
    name,
    isDeleted: false,
  };
  const folder =
    (await state.db.repositoryFolders.findFirst({
      where,
      select: { id: true },
    })) ??
    (await state.db.repositoryFolders.create({
      data: {
        projectId: project.projectId,
        repositoryId: project.repositoryId,
        name,
        creatorId: state.importerId,
      },
      select: { id: true },
    }));
  project.fallbackFolderId = folder.id;
  return folder.id;
}

async function importSharedSteps(state: ImportState, project: ProjectContext) {
  const { db, jobId } = state;
  const records = await loadQaseStaged(db, jobId, "shared_step", project.code);
  const done = await loadMappings(db, jobId, "shared_step", project.code);
  for (const [sourceId, targetId] of done) {
    project.sharedStepIds.set(sourceId, Number(targetId));
  }
  for (const record of records) {
    const hash = asText(record.hash);
    if (!hash || project.sharedStepIds.has(hash)) {
      continue;
    }
    const name = (asText(record.title).trim() || "Shared steps").slice(0, 255);
    const built = await buildSteps(state, flattenQaseSteps(record.steps), name);
    const items = built.steps.filter((step) => !step.sharedHash);
    const groupId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const group = await tx.sharedStepGroup.create({
        data: {
          name,
          projectId: project.projectId,
          createdById: state.importerId,
          items: {
            create: items.map((item, order) => ({
              order,
              step: item.step as JsonObject,
              expectedResult: item.expectedResult as JsonObject,
            })),
          },
        },
        select: { id: true },
      });
      await remember(tx, jobId, "shared_step", project.code, hash, group.id);
      return group.id;
    });
    if (built.files.length > 0) {
      warn(state, { code: "shared_step_files_skipped", subject: name });
    }
    project.sharedStepIds.set(hash, groupId);
    state.progress.sharedSteps.done += 1;
    await persist(state, "sharedSteps");
  }
}

async function importCase(
  state: ImportState,
  project: ProjectContext,
  record: QaseRecord
) {
  const { db, jobId, config } = state;
  const sourceId = String(record.id);
  const name = (asText(record.title).trim() || `Case ${sourceId}`).slice(
    0,
    255
  );

  const longTexts = state.fields
    .filter((plan) => plan.target.type === "Text Long")
    .flatMap((plan) => qaseCaseFieldRawValues(record, plan.source.key));
  const resolveImage = await copyImages(state, longTexts, name);

  const fieldValues: { fieldId: number; value: unknown }[] = [];
  for (const plan of state.fields) {
    const raw = qaseCaseFieldRawValues(record, plan.source.key);
    if (plan.target.type === "Text Long") {
      const doc = qaseTextToDoc(raw[0], resolveImage);
      if (!isEmptyDoc(doc)) {
        fieldValues.push({ fieldId: plan.fieldId, value: JSON.stringify(doc) });
      }
      continue;
    }
    const converted = convertQaseFieldValue(plan.source, raw, plan.target);
    if (converted.kind === "value") {
      fieldValues.push({ fieldId: plan.fieldId, value: converted.value });
    } else if (converted.kind === "unmatched") {
      warn(state, {
        code: "option_unmatched",
        subject: `${plan.source.title}: ${converted.option}`,
      });
    }
  }

  const built = await buildSteps(
    state,
    flattenQaseSteps(record.steps, record.steps_type),
    name
  );
  const steps = built.steps.filter((step) => {
    if (step.sharedHash && !project.sharedStepIds.has(step.sharedHash)) {
      warn(state, { code: "shared_step_missing", subject: name });
      return false;
    }
    return true;
  });
  const attachments = await copyAttachments(
    state,
    [...toQaseFiles(record.attachments), ...built.files],
    name
  );

  const tagNames = (
    Array.isArray(record.tags) ? (record.tags as QaseRecord[]) : []
  )
    .map((tag) => asText(tag?.title))
    .filter(Boolean);
  const automated = record.isManual === false || record.automation === 2;
  if (
    !automated &&
    (record.isToBeAutomated === true || record.automation === 1)
  ) {
    tagNames.push(TO_BE_AUTOMATED_TAG);
  }
  const tagIds = new Set<number>();
  for (const tagName of tagNames) {
    const tagId = await resolveTag(state, tagName);
    if (tagId) {
      tagIds.add(tagId);
    }
  }

  const parameters = buildQaseParameterSet(record.parameters);
  if (parameters.truncated) {
    warn(state, { code: "parameter_rows_skipped", subject: name });
  }

  const mappedCreator =
    record.member_id === undefined || record.member_id === null
      ? null
      : (config.users[String(record.member_id)]?.mappedTo ?? null);
  const creatorId =
    mappedCreator && state.userNames.has(mappedCreator)
      ? mappedCreator
      : state.importerId;
  const createdAt = toDate(record.created_at) ?? new Date();
  const stateId =
    config.caseStatuses[String(record.status)]?.mappedTo ??
    project.defaultStateId;
  const folderId =
    (record.suite_id !== null && record.suite_id !== undefined
      ? project.folderIds.get(String(record.suite_id))
      : undefined) ?? (await fallbackFolder(state, project));

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
    const created = await tx.repositoryCases.create({
      data: {
        projectId: project.projectId,
        repositoryId: project.repositoryId,
        folderId,
        templateId: state.templateId,
        name,
        stateId,
        source: "MANUAL",
        automated,
        order: Number(record.position ?? 0) || 0,
        createdAt,
        creatorId,
        currentVersion: 1,
      },
      select: { id: true },
    });
    const caseId = created.id;

    if (fieldValues.length > 0) {
      await tx.caseFieldValues.createMany({
        data: fieldValues.map((entry) => ({
          testCaseId: caseId,
          fieldId: entry.fieldId,
          value: entry.value as JsonObject,
        })),
      });
    }
    if (steps.length > 0) {
      await tx.steps.createMany({
        data: steps.map((step, order) => ({
          testCaseId: caseId,
          order,
          step: step.step as JsonObject,
          expectedResult: step.expectedResult as JsonObject,
          sharedStepGroupId: step.sharedHash
            ? (project.sharedStepIds.get(step.sharedHash) ?? null)
            : null,
        })),
      });
    }
    if (tagIds.size > 0) {
      await tx.repositoryCaseTag.createMany({
        data: [...tagIds].map((tagId) => ({ caseId, tagId })),
        skipDuplicates: true,
      });
    }
    if (attachments.length > 0) {
      await tx.attachments.createMany({
        data: attachments.map(({ file, copied }) => ({
          testCaseId: caseId,
          url: copied.url,
          name: file.filename.slice(0, 255) || "attachment",
          note: "",
          mimeType: copied.mime,
          size: BigInt(copied.size),
          createdById: creatorId,
        })),
      });
    }
    if (parameters.names.length > 0) {
      await tx.testCaseParameter.createMany({
        data: parameters.names.map((parameterName, order) => ({
          testCaseId: caseId,
          name: parameterName,
          type: "STRING" as const,
          order,
        })),
      });
      await tx.repositoryCases.update({
        where: { id: caseId },
        data: { hasParameters: true },
      });
      if (parameters.rows.length > 0) {
        const dataset = await tx.dataSet.create({
          data: {
            projectId: project.projectId,
            ownerCaseId: caseId,
            name: `${name} dataset`.slice(0, 255),
            isShared: false,
            createdById: creatorId,
          },
          select: { id: true },
        });
        await tx.dataSetVersion.create({
          data: {
            dataSetId: dataset.id,
            version: 1,
            parametersJson: parameters.names.map((parameterName) => ({
              name: parameterName,
              type: "STRING",
              required: false,
              sensitive: false,
            })),
            rowsJson: parameters.rows.map((values, rowIndex) => ({
              rowIndex,
              label: null,
              values,
            })),
            rowCount: parameters.rows.length,
            createdById: creatorId,
          },
        });
        await tx.dataSetRow.createMany({
          data: parameters.rows.map((values, rowIndex) => ({
            dataSetId: dataset.id,
            rowIndex,
            valuesJson: values,
          })),
        });
      }
    }

    await createTestCaseVersionInTransaction(tx, caseId, {
      version: 1,
      creatorId,
      creatorName: state.userNames.get(creatorId) || "Import",
      createdAt,
      copyFieldValues: true,
    });
    await remember(tx, jobId, "case", project.code, sourceId, caseId);
  });
}

async function importProject(
  state: ImportState,
  summary: QaseProjectSummary,
  cases: QaseRecord[]
): Promise<number> {
  const { db, jobId, config } = state;
  const projectId = config.projects[summary.code]?.mappedTo as number;
  const repository = await findOrCreateProjectRepository(db, projectId);

  const stateIds = [
    ...new Set(
      Object.values(config.caseStatuses)
        .map((entry) => entry.mappedTo)
        .filter((id): id is number => typeof id === "number")
    ),
  ];
  await db.templateProjectAssignment.createMany({
    data: [{ templateId: state.templateId, projectId }],
    skipDuplicates: true,
  });
  await db.projectWorkflowAssignment.createMany({
    data: stateIds.map((workflowId) => ({ workflowId, projectId })),
    skipDuplicates: true,
  });

  const project: ProjectContext = {
    code: summary.code,
    title: summary.title,
    projectId,
    repositoryId: repository.id,
    folderIds: new Map(),
    sharedStepIds: new Map(),
    fallbackFolderId: null,
    defaultStateId: stateIds[0],
    caseRecords: new Map(cases.map((record) => [String(record.id), record])),
  };

  await importFolders(state, project);
  await importSharedSteps(state, project);

  const done = await loadMappings(db, jobId, "case", project.code);
  for (const record of cases) {
    if (done.has(String(record.id))) {
      continue;
    }
    try {
      await importCase(state, project, record);
    } catch (error) {
      if (error instanceof QaseImportCanceledError) {
        throw error;
      }
      state.progress.cases.failed = (state.progress.cases.failed ?? 0) + 1;
      warn(state, {
        code: "case_failed",
        subject: asText(record.title) || String(record.id),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    state.progress.cases.done += 1;
    await persist(state, "cases");
  }

  await importExecution(state, project);
  await importIssues(state, project, cases);
  return projectId;
}

/** Files counted by an earlier attempt; their cases are not imported again. */
function earlierFiles(value: unknown): { done: number; total: number } {
  const files =
    value && typeof value === "object"
      ? (value as { files?: { done?: unknown; total?: unknown } }).files
      : undefined;
  const count = (entry: unknown) =>
    typeof entry === "number" && Number.isInteger(entry) && entry > 0
      ? entry
      : 0;
  return { done: count(files?.done), total: count(files?.total) };
}

/** Warnings an earlier attempt recorded, kept so a retry does not hide them. */
function earlierWarnings(value: unknown): QaseImportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[])
    .filter(
      (entry): entry is QaseImportWarning =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as QaseImportWarning).code === "string" &&
        typeof (entry as QaseImportWarning).subject === "string"
    )
    .slice(0, MAX_WARNINGS);
}

/**
 * The import phase of a Qase job: writes the staged repository data into the
 * mapped projects. A retry continues after what an earlier attempt created.
 */
export async function runQaseImport({
  db,
  jobId,
  copierOptions,
  onCompleted,
}: RunQaseImportOptions): Promise<void> {
  const job = await db.qaseImportJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      createdById: true,
      projects: true,
      configuration: true,
      cancelRequested: true,
      entityProgress: true,
      activityLog: true,
    },
  });
  if (!job) {
    throw new Error(`Qase import job ${jobId} not found`);
  }

  const startedAt = new Date();
  let current: ImportState | null = null;
  /** What was imported up to now, so a stopped job shows true counts. */
  const snapshot = () =>
    current
      ? {
          entityProgress: current.progress as unknown as JsonObject,
          activityLog: current.warnings as unknown as JsonObject[],
        }
      : {};
  const finishCanceled = async () => {
    await db.qaseImportStaging.deleteMany({ where: { jobId } });
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        ...snapshot(),
        status: "CANCELED",
        statusMessage: "Canceled",
        canceledAt: new Date(),
        currentEntity: null,
        apiToken: null,
      },
    });
  };
  if (job.cancelRequested) {
    await finishCanceled();
    return;
  }

  await db.qaseImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "IMPORTING",
      statusMessage: "Importing into TestPlanIt",
      lastImportStartedAt: startedAt,
      completedAt: null,
      error: null,
    },
  });

  try {
    const analysis = await buildQaseAnalysis(db, job);
    const config = normalizeQaseMapping(job.configuration);
    // What an earlier attempt created is mapped now, not created again.
    for (const [key, fieldId] of await loadMappings(db, jobId, "field")) {
      if (config.fields[key]?.action === "create") {
        config.fields[key] = {
          action: "map",
          mappedTo: Number(fieldId),
          name: "",
        };
      }
    }
    const createdTemplate = (await loadMappings(db, jobId, "template")).get(
      "template"
    );
    if (createdTemplate && config.template.action === "create") {
      config.template = {
        action: "map",
        mappedTo: Number(createdTemplate),
        name: "",
      };
    }
    // Projects and users an earlier attempt created are used, not made again.
    for (const [code, projectId] of await loadMappings(db, jobId, "project")) {
      if (config.projects[code]?.action === "create") {
        config.projects[code] = {
          action: "map",
          mappedTo: Number(projectId),
          name: "",
        };
      }
    }
    for (const [sourceId, userId] of await loadMappings(db, jobId, "user")) {
      if (config.users[sourceId]?.action === "create") {
        config.users[sourceId] = { ...unmappedQaseUser(), mappedTo: userId };
      }
    }
    for (const [slug, statusId] of await loadMappings(
      db,
      jobId,
      "result_status"
    )) {
      const mapping = config.resultStatuses[slug];
      if (mapping?.action === "create") {
        config.resultStatuses[slug] = {
          ...mapping,
          action: "map",
          mappedTo: Number(statusId),
          name: "",
        };
      }
    }
    for (const [trackerId, integrationId] of await loadMappings(
      db,
      jobId,
      "issue_tracker"
    )) {
      if (config.issueTrackers[trackerId]?.action === "create") {
        config.issueTrackers[trackerId] = {
          action: "map",
          mappedTo: Number(integrationId),
          name: "",
        };
      }
    }
    const problems = validateQaseMapping(config, analysis);
    if (problems.length > 0) {
      throw new Error(
        `The mapping is not complete: ${problems.map((problem) => problem.code).join(", ")}`
      );
    }

    const users = await db.user.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, email: true },
    });
    const knownFiles = new Map<string, QaseCopiedFile>();
    for (const [sourceId, targetId] of await loadMappings(db, jobId, "file")) {
      try {
        knownFiles.set(sourceId, JSON.parse(targetId) as QaseCopiedFile);
      } catch {
        // An unreadable entry only means the file is copied again.
      }
    }

    const projects = analysis.source.projects;
    const casesByProject = new Map<string, QaseRecord[]>();
    const progress: QaseImportProgress = {
      folders: { done: 0, total: 0 },
      sharedSteps: { done: 0, total: 0 },
      cases: { done: 0, total: 0 },
      milestones: { done: 0, total: 0 },
      runs: { done: 0, total: 0 },
      results: { done: 0, total: 0 },
      issues: { done: 0, total: 0 },
      files: earlierFiles(job.entityProgress),
    };
    const warnings = earlierWarnings(job.activityLog);
    for (const project of projects) {
      const cases = await loadQaseStaged(db, jobId, "case", project.code);
      casesByProject.set(project.code, cases);
      const [suites, sharedSteps, doneSuites, doneShared, doneCases] =
        await Promise.all([
          db.qaseImportStaging.count({
            where: { jobId, entity: "suite", projectCode: project.code },
          }),
          db.qaseImportStaging.count({
            where: { jobId, entity: "shared_step", projectCode: project.code },
          }),
          loadMappings(db, jobId, "suite", project.code),
          loadMappings(db, jobId, "shared_step", project.code),
          loadMappings(db, jobId, "case", project.code),
        ]);
      progress.folders.total += suites;
      progress.folders.done += doneSuites.size;
      progress.sharedSteps.total += sharedSteps;
      progress.sharedSteps.done += doneShared.size;
      progress.cases.total += cases.length;
      progress.cases.done += doneCases.size;
      for (const [key, entity] of [
        ["milestones", "milestone"],
        ["runs", "run"],
        ["results", "result"],
      ] as const) {
        progress[key].total += await db.qaseImportStaging.count({
          where: { jobId, entity, projectCode: project.code },
        });
        progress[key].done += (
          await loadMappings(db, jobId, entity, project.code)
        ).size;
      }
      progress.issues.total += countQaseIssues(
        await db.qaseImportStaging.count({
          where: { jobId, entity: "defect", projectCode: project.code },
        }),
        cases,
        await loadQaseStaged(db, jobId, "run", project.code)
      );
      progress.issues.done += (
        await loadMappings(db, jobId, "defect", project.code)
      ).size;
    }
    const systemFields = await loadQaseStaged(db, jobId, "system_field");
    const authorUsers = new Map<string, string>();
    for (const author of await loadQaseStaged(db, jobId, "author")) {
      if (author.entity_type === "user" && asText(author.uuid)) {
        authorUsers.set(asText(author.uuid), String(author.entity_id));
      }
    }

    const state: ImportState = {
      db,
      jobId,
      importerId: job.createdById,
      config,
      analysis,
      progress,
      warnings,
      warningKeys: new Set(
        warnings.map((warning) => `${warning.code}:${warning.subject}`)
      ),
      lastPersist: 0,
      copier: new QaseFileCopier({
        ...copierOptions,
        jobId,
        known: knownFiles,
        onCopied: async (key, file) => {
          await remember(db, jobId, "file", "", key, JSON.stringify(file));
        },
      }),
      userNames: new Map(
        users.map((user) => [user.id, user.name || user.email || ""])
      ),
      tagIds: new Map(),
      templateId: 0,
      fields: [],
      statuses: new Map(),
      statusSlugs: qaseResultStatusSlugs(systemFields),
      customFields: await loadQaseStaged(db, jobId, "custom_field"),
      authorUsers,
      trackers: new Map(),
    };
    current = state;
    if (!analysis.storageConfigured) {
      warn(state, { code: "storage_not_configured", subject: "" });
    }

    await persist(state, "template", true);
    await prepareProjects(state);
    await prepareUsers(state);
    await prepareTemplate(state);
    await prepareResultStatuses(state);
    await prepareIssueTrackers(state);

    const projectIds: number[] = [];
    for (const project of projects) {
      projectIds.push(
        await importProject(
          state,
          project,
          casesByProject.get(project.code) ?? []
        )
      );
    }

    await persist(state, null, true);
    await db.qaseImportStaging.deleteMany({ where: { jobId } });
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        phase: null,
        statusMessage: "Import completed",
        currentEntity: null,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        apiToken: null,
      },
    });
    await onCompleted?.(
      [...new Set(projectIds)],
      (await loadMappings(db, jobId, "project")).size > 0
    );
  } catch (error) {
    if (error instanceof QaseImportCanceledError) {
      await finishCanceled();
      return;
    }
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        ...snapshot(),
        status: "FAILED",
        statusMessage: "The import failed",
        error: error instanceof Error ? error.message : String(error),
        currentEntity: null,
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    throw error;
  }
}
