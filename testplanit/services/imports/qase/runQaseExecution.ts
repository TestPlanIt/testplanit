import type { JSONContent } from "@tiptap/core";
import type { JsonObject } from "@zenstackhq/orm";
import { updateTestRunForecast } from "~/services/forecastService";
import { loadQaseStaged, QASE_RUN_STATUS_SCOPE } from "./analysis";
import {
  flattenQaseStepResults,
  isEmptyDoc,
  isQaseRunCompleted,
  qaseResultNotes,
  qaseRunCaseIds,
  qaseRunDescription,
  qaseSeconds,
  qaseStepSlots,
  qaseTextToDoc,
  toQaseFiles,
  type QaseStepSlot,
} from "./content";
import {
  EMPTY_DOC,
  QaseImportCanceledError,
  asText,
  copyAttachments,
  copyImages,
  loadMappings,
  persist,
  remember,
  resolveTag,
  toDate,
  warn,
  type ImportState,
  type ProjectContext,
} from "./importContext";

type QaseRecord = Record<string, unknown>;

const ENVIRONMENT_CATEGORY = "Environment";
const DEFAULT_STATUS_COLOR = "#B1B2B3";

const toSystemName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "status";

/** Qase text as a document, with its inline images copied. */
async function textToDoc(
  state: ImportState,
  text: string,
  subject: string
): Promise<JSONContent> {
  if (!text.trim()) {
    return EMPTY_DOC;
  }
  const resolveImage = await copyImages(state, [text], subject);
  const doc = qaseTextToDoc(text, resolveImage);
  return isEmptyDoc(doc) ? EMPTY_DOC : doc;
}

/** The TestPlanIt user a Qase user id stands for, else the person importing. */
function userFor(state: ImportState, qaseUserId: unknown): string {
  if (qaseUserId === undefined || qaseUserId === null) {
    return state.importerId;
  }
  const mapped = state.config.users[String(qaseUserId)]?.mappedTo ?? null;
  return mapped && state.userNames.has(mapped) ? mapped : state.importerId;
}

/**
 * Resolves each Qase result status to a TestPlanIt status, creating the ones
 * the mapping asks for. A status of the same name is used instead of a
 * second one being made.
 */
export async function prepareResultStatuses(state: ImportState): Promise<void> {
  const { db, jobId, config, analysis } = state;
  const known = await loadMappings(db, jobId, "result_status");
  for (const source of analysis.source.resultStatuses) {
    const mapping = config.resultStatuses[source.id];
    if (!mapping) {
      continue;
    }
    const knownId = known.get(source.id);
    if (mapping.action === "map" || knownId) {
      const status = await db.status.findUnique({
        where: { id: knownId ? Number(knownId) : (mapping.mappedTo ?? 0) },
        select: { id: true, isCompleted: true },
      });
      if (status) {
        state.statuses.set(source.id, status);
      }
      continue;
    }
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const scope = await tx.statusScope.findFirst({
        where: { name: QASE_RUN_STATUS_SCOPE },
        select: { id: true },
      });
      if (!scope) {
        throw new Error(
          `The "${QASE_RUN_STATUS_SCOPE}" status scope does not exist.`
        );
      }
      const sameNamed = await tx.status.findFirst({
        where: { name: { equals: mapping.name, mode: "insensitive" } },
        select: { id: true, isCompleted: true, isDeleted: true },
      });
      if (sameNamed) {
        await tx.status.update({
          where: { id: sameNamed.id },
          data: { isDeleted: false, isEnabled: true },
        });
        await tx.statusScopeAssignment.createMany({
          data: [{ statusId: sameNamed.id, scopeId: scope.id }],
          skipDuplicates: true,
        });
        await remember(tx, jobId, "result_status", "", source.id, sameNamed.id);
        return { id: sameNamed.id, isCompleted: sameNamed.isCompleted };
      }
      const color =
        (await tx.color.findFirst({
          where: {
            value: { equals: DEFAULT_STATUS_COLOR, mode: "insensitive" },
          },
          select: { id: true },
        })) ??
        (await tx.color.findFirst({
          select: { id: true },
          orderBy: { id: "asc" },
        }));
      if (!color) {
        throw new Error("No colour is available for a new status.");
      }
      const taken = new Set(
        (await tx.status.findMany({ select: { systemName: true } })).map(
          (status) => status.systemName
        )
      );
      const base = toSystemName(mapping.name);
      let systemName = base;
      for (let suffix = 2; taken.has(systemName); suffix++) {
        systemName = `${base}_${suffix}`;
      }
      const status = await tx.status.create({
        data: {
          name: mapping.name,
          systemName,
          colorId: color.id,
          isEnabled: true,
          isSuccess: mapping.isSuccess,
          isFailure: mapping.isFailure,
          isCompleted: mapping.isCompleted,
          scope: { create: [{ scopeId: scope.id }] },
        },
        select: { id: true, isCompleted: true },
      });
      await remember(tx, jobId, "result_status", "", source.id, status.id);
      return status;
    });
    state.statuses.set(source.id, created);
  }
}

/** Qase milestones as TestPlanIt milestones; one of the same name is reused. */
async function importMilestones(
  state: ImportState,
  project: ProjectContext
): Promise<Map<string, number>> {
  const { db, jobId, config } = state;
  const records = await loadQaseStaged(db, jobId, "milestone", project.code);
  const done = await loadMappings(db, jobId, "milestone", project.code);
  const byTitle = new Map<string, number>();
  const typeId = config.milestoneTypeId;
  if (records.length > 0 && typeId) {
    await db.milestoneTypesAssignment.createMany({
      data: [{ projectId: project.projectId, milestoneTypeId: typeId }],
      skipDuplicates: true,
    });
  }
  for (const record of records) {
    const sourceId = String(record.id);
    const name = (asText(record.title).trim() || `Milestone ${sourceId}`).slice(
      0,
      255
    );
    const known = done.get(sourceId);
    if (known) {
      byTitle.set(name.toLowerCase(), Number(known));
      continue;
    }
    if (!typeId) {
      continue;
    }
    const note = await textToDoc(state, asText(record.description), name);
    const completed = asText(record.status) === "completed";
    const createdAt = toDate(record.created_at) ?? new Date();
    const id = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const existing = await tx.milestones.findFirst({
        where: {
          projectId: project.projectId,
          isDeleted: false,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });
      const milestoneId =
        existing?.id ??
        (
          await tx.milestones.create({
            data: {
              projectId: project.projectId,
              milestoneTypesId: typeId,
              name,
              note: note as JsonObject,
              docs: EMPTY_DOC as JsonObject,
              isStarted: true,
              isCompleted: completed,
              startedAt: createdAt,
              // The due date; TestPlanIt keeps it in the completion date.
              completedAt:
                toDate(record.due_date) ??
                (completed ? toDate(record.updated_at) : undefined),
              createdAt,
              createdBy: state.importerId,
            },
            select: { id: true },
          })
        ).id;
      await remember(
        tx,
        jobId,
        "milestone",
        project.code,
        sourceId,
        milestoneId
      );
      return milestoneId;
    });
    byTitle.set(name.toLowerCase(), id);
    state.progress.milestones.done += 1;
    await persist(state, "milestones");
  }
  return byTitle;
}

/**
 * Finds or creates the configuration a Qase run was executed on. A Qase
 * configuration group is a category and its values are variants; the run's
 * environment is a variant of the "Environment" category.
 */
class ConfigurationResolver {
  private readonly values = new Map<string, { group: string; title: string }>();
  private readonly variants = new Map<string, { id: number; name: string }>();
  private readonly configurations = new Map<string, number>();

  constructor(
    private readonly state: ImportState,
    private readonly project: ProjectContext,
    groups: QaseRecord[]
  ) {
    for (const group of groups) {
      for (const value of Array.isArray(group.configurations)
        ? (group.configurations as QaseRecord[])
        : []) {
        this.values.set(String(value.id), {
          group: asText(group.title).trim(),
          title: asText(value.title).trim(),
        });
      }
    }
  }

  private async variant(
    category: string,
    name: string
  ): Promise<{ id: number; name: string }> {
    const key = `${category.toLowerCase()}\u0000${name.toLowerCase()}`;
    const cached = this.variants.get(key);
    if (cached) {
      return cached;
    }
    const { db } = this.state;
    const variant = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      const existingCategory = await tx.configCategories.findFirst({
        where: {
          isDeleted: false,
          name: { equals: category, mode: "insensitive" },
        },
        select: { id: true },
      });
      const categoryId =
        existingCategory?.id ??
        (
          await tx.configCategories.create({
            data: { name: category.slice(0, 255) },
            select: { id: true },
          })
        ).id;
      const existingVariant = await tx.configVariants.findFirst({
        where: {
          categoryId,
          isDeleted: false,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true, name: true },
      });
      return (
        existingVariant ??
        (await tx.configVariants.create({
          data: { name: name.slice(0, 255), categoryId },
          select: { id: true, name: true },
        }))
      );
    });
    this.variants.set(key, variant);
    return variant;
  }

  /** The configuration for a run, or null when the run names none. */
  async forRun(run: QaseRecord): Promise<number | null> {
    const parts: { category: string; name: string }[] = [];
    for (const valueId of Array.isArray(run.configurations)
      ? run.configurations
      : []) {
      const value = this.values.get(String(valueId));
      if (value?.group && value.title) {
        parts.push({ category: value.group, name: value.title });
      }
    }
    const environment = asText(
      (run.environment as QaseRecord | null)?.title
    ).trim();
    if (environment) {
      parts.push({ category: ENVIRONMENT_CATEGORY, name: environment });
    }
    if (parts.length === 0) {
      return null;
    }
    const resolved = new Map<number, string>();
    for (const part of parts) {
      const variant = await this.variant(part.category, part.name);
      resolved.set(variant.id, variant.name);
    }
    const variantIds = [...resolved.keys()].sort((a, b) => a - b);
    const key = variantIds.join(",");
    let configurationId = this.configurations.get(key);
    if (!configurationId) {
      const { db } = this.state;
      configurationId = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
        const candidates = await tx.configurations.findMany({
          where: {
            isDeleted: false,
            AND: variantIds.map((variantId) => ({
              variants: { some: { variantId } },
            })),
          },
          select: { id: true, variants: { select: { variantId: true } } },
        });
        const exact = candidates.find(
          (candidate) => candidate.variants.length === variantIds.length
        );
        if (exact) {
          return exact.id;
        }
        const created = await tx.configurations.create({
          data: {
            name: [...resolved.values()].join(", ").slice(0, 255),
            variants: {
              create: variantIds.map((variantId) => ({ variantId })),
            },
          },
          select: { id: true },
        });
        return created.id;
      });
      this.configurations.set(key, configurationId);
    }
    await this.state.db.projectConfigurationAssignment.createMany({
      data: [{ configurationId, projectId: this.project.projectId }],
      skipDuplicates: true,
    });
    return configurationId;
  }
}

interface RunContext {
  runId: number;
  /** Run case id by TestPlanIt case id. */
  runCases: Map<number, number>;
  completed: boolean;
}

/** Creates a Qase run with its cases and tags. */
async function importRun(
  state: ImportState,
  project: ProjectContext,
  run: QaseRecord,
  caseIds: Map<string, number>,
  milestones: Map<string, number>,
  configurations: ConfigurationResolver
): Promise<void> {
  const { db, jobId, config } = state;
  const sourceId = String(run.id);
  const name = (asText(run.title).trim() || `Run ${sourceId}`).slice(0, 255);
  const completed = isQaseRunCompleted(run);
  const stateId = completed
    ? config.runStates.completed
    : config.runStates.active;
  if (!stateId) {
    throw new Error("No workflow state is chosen for test runs.");
  }
  const note = await textToDoc(
    state,
    qaseRunDescription(run, state.customFields),
    name
  );
  const configId = await configurations.forRun(run);
  const milestoneTitle = asText(
    (run.milestone as QaseRecord | null)?.title
  ).trim();
  const milestoneId = milestoneTitle
    ? (milestones.get(milestoneTitle.toLowerCase()) ?? null)
    : null;

  const repositoryCaseIds: number[] = [];
  for (const qaseCaseId of qaseRunCaseIds(run)) {
    const caseId = caseIds.get(qaseCaseId);
    if (caseId) {
      repositoryCaseIds.push(caseId);
    } else {
      warn(state, { code: "run_case_missing", subject: name });
    }
  }
  const tagIds: number[] = [];
  for (const tag of Array.isArray(run.tags) ? (run.tags as QaseRecord[]) : []) {
    const tagId = await resolveTag(state, asText(tag?.title));
    if (tagId) {
      tagIds.push(tagId);
    }
  }
  const createdAt = toDate(run.start_time) ?? new Date();

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
    const created = await tx.testRuns.create({
      data: {
        projectId: project.projectId,
        name,
        note: note as JsonObject,
        docs: EMPTY_DOC as JsonObject,
        stateId,
        configId,
        milestoneId,
        elapsed: qaseSeconds(run.time_spent),
        isCompleted: completed,
        completedAt: completed
          ? (toDate(run.end_time) ?? createdAt)
          : undefined,
        createdAt,
        createdById: userFor(state, run.user_id),
        testRunType: "REGULAR",
        tags: { connect: [...new Set(tagIds)].map((id) => ({ id })) },
      },
      select: { id: true },
    });
    if (repositoryCaseIds.length > 0) {
      await tx.testRunCases.createMany({
        data: repositoryCaseIds.map((repositoryCaseId, order) => ({
          testRunId: created.id,
          repositoryCaseId,
          order,
        })),
      });
    }
    await remember(tx, jobId, "run", project.code, sourceId, created.id);
  });
}

interface CaseSteps {
  slots: Map<string, QaseStepSlot>;
  /** The case's step rows in order, with a shared step's items. */
  rows: { id: number; sharedItemIds: number[] }[];
}

/** Records a Qase result, its step results and its files. */
async function importResult(
  state: ImportState,
  project: ProjectContext,
  result: QaseRecord,
  run: RunContext,
  runCaseId: number,
  attempt: number,
  steps: CaseSteps,
  subject: string
): Promise<void> {
  const { db, jobId } = state;
  const sourceId = asText(result.hash);
  const status = state.statuses.get(asText(result.status));
  if (!status) {
    throw new Error(`No status is mapped for "${asText(result.status)}".`);
  }
  const notes = await textToDoc(state, qaseResultNotes(result), subject);
  const files = await copyAttachments(
    state,
    toQaseFiles(result.attachments),
    subject
  );
  const executedById = userFor(
    state,
    state.authorUsers.get(asText(result.author_uuid))
  );
  const executedAt = toDate(result.end_time) ?? new Date();
  const elapsed = qaseSeconds(result.time_spent_ms);

  const stepResults: {
    stepId: number;
    sharedStepItemId: number | null;
    statusId: number;
    notes: JSONContent;
    files: Awaited<ReturnType<typeof copyAttachments>>;
  }[] = [];
  const used = new Set<string>();
  for (const stepResult of flattenQaseStepResults(result.steps)) {
    const slot = steps.slots.get(stepResult.path);
    const row = slot ? steps.rows[slot.index] : undefined;
    const stepStatus =
      stepResult.status === null
        ? undefined
        : state.statuses.get(state.statusSlugs.get(stepResult.status) ?? "");
    if (!slot || !row || !stepStatus) {
      continue;
    }
    const sharedStepItemId =
      slot.sharedItem === null
        ? null
        : (row.sharedItemIds[slot.sharedItem] ?? null);
    const key = `${row.id}:${sharedStepItemId}`;
    if (used.has(key) || (slot.sharedItem !== null && !sharedStepItemId)) {
      continue;
    }
    used.add(key);
    stepResults.push({
      stepId: row.id,
      sharedStepItemId,
      statusId: stepStatus.id,
      notes: await textToDoc(state, stepResult.comment, subject),
      files: await copyAttachments(state, stepResult.attachments, subject),
    });
  }

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
    const created = await tx.testRunResults.create({
      data: {
        testRunId: run.runId,
        testRunCaseId: runCaseId,
        statusId: status.id,
        executedById,
        executedAt,
        elapsed,
        attempt,
        notes: notes as JsonObject,
        evidence: {},
      },
      select: { id: true },
    });
    const attachments = files.map(({ file, copied }) => ({
      testRunResultsId: created.id as number | null,
      testRunStepResultId: null as number | null,
      url: copied.url,
      name: file.filename.slice(0, 255) || "attachment",
      note: "",
      mimeType: copied.mime,
      size: BigInt(copied.size),
      createdById: executedById,
    }));
    for (const stepResult of stepResults) {
      const createdStep = await tx.testRunStepResults.create({
        data: {
          testRunResultId: created.id,
          stepId: stepResult.stepId,
          sharedStepItemId: stepResult.sharedStepItemId,
          statusId: stepResult.statusId,
          notes: stepResult.notes as JsonObject,
          evidence: {},
          executedAt,
        },
        select: { id: true },
      });
      for (const { file, copied } of stepResult.files) {
        attachments.push({
          testRunResultsId: null,
          testRunStepResultId: createdStep.id,
          url: copied.url,
          name: file.filename.slice(0, 255) || "attachment",
          note: "",
          mimeType: copied.mime,
          size: BigInt(copied.size),
          createdById: executedById,
        });
      }
    }
    if (attachments.length > 0) {
      await tx.attachments.createMany({ data: attachments });
    }
    await remember(tx, jobId, "result", project.code, sourceId, created.id);
  });
}

/**
 * The planning and execution data of one Qase project: milestones, the
 * configurations runs were executed on, runs with their cases, and results.
 */
export async function importExecution(
  state: ImportState,
  project: ProjectContext
): Promise<void> {
  const { db, jobId, config } = state;
  const runs = await loadQaseStaged(db, jobId, "run", project.code);
  const milestones = await importMilestones(state, project);
  if (runs.length === 0) {
    return;
  }

  // What the runs need from the project: their states and result statuses.
  await db.projectWorkflowAssignment.createMany({
    data: [config.runStates.active, config.runStates.completed]
      .filter((id): id is number => typeof id === "number")
      .map((workflowId) => ({ workflowId, projectId: project.projectId })),
    skipDuplicates: true,
  });
  await db.projectStatusAssignment.createMany({
    data: [
      ...new Set([...state.statuses.values()].map((status) => status.id)),
    ].map((statusId) => ({ statusId, projectId: project.projectId })),
    skipDuplicates: true,
  });

  const caseIds = new Map<string, number>();
  for (const [sourceId, targetId] of await loadMappings(
    db,
    jobId,
    "case",
    project.code
  )) {
    caseIds.set(sourceId, Number(targetId));
  }
  const configurations = new ConfigurationResolver(
    state,
    project,
    await loadQaseStaged(db, jobId, "configuration", project.code)
  );

  let doneRuns = await loadMappings(db, jobId, "run", project.code);
  for (const run of runs) {
    if (doneRuns.has(String(run.id))) {
      continue;
    }
    try {
      await importRun(state, project, run, caseIds, milestones, configurations);
    } catch (error) {
      if (error instanceof QaseImportCanceledError) {
        throw error;
      }
      state.progress.runs.failed = (state.progress.runs.failed ?? 0) + 1;
      warn(state, {
        code: "run_failed",
        subject: asText(run.title) || String(run.id),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    state.progress.runs.done += 1;
    await persist(state, "runs");
  }

  doneRuns = await loadMappings(db, jobId, "run", project.code);
  const runContexts = new Map<string, RunContext>();
  for (const run of runs) {
    const runId = Number(doneRuns.get(String(run.id)));
    if (!runId) {
      continue;
    }
    const runCases = await db.testRunCases.findMany({
      where: { testRunId: runId, isDeleted: false },
      select: { id: true, repositoryCaseId: true },
    });
    runContexts.set(String(run.id), {
      runId,
      runCases: new Map(
        runCases.map((entry) => [entry.repositoryCaseId, entry.id])
      ),
      completed: isQaseRunCompleted(run),
    });
  }

  const results = (
    await loadQaseStaged(db, jobId, "result", project.code)
  ).sort(
    (a, b) =>
      (toDate(a.end_time)?.getTime() ?? 0) -
      (toDate(b.end_time)?.getTime() ?? 0)
  );
  const doneResults = await loadMappings(db, jobId, "result", project.code);
  const caseSteps = new Map<number, CaseSteps>();
  const stepsOf = async (qaseCaseId: string, caseId: number) => {
    let steps = caseSteps.get(caseId);
    if (!steps) {
      const record = project.caseRecords.get(qaseCaseId);
      const rows = await db.steps.findMany({
        where: { testCaseId: caseId, isDeleted: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          sharedStepGroup: {
            select: {
              items: { orderBy: { order: "asc" }, select: { id: true } },
            },
          },
        },
      });
      steps = {
        slots: qaseStepSlots(record?.steps, record?.steps_type),
        rows: rows.map((row) => ({
          id: row.id,
          sharedItemIds:
            row.sharedStepGroup?.items.map((item) => item.id) ?? [],
        })),
      };
      caseSteps.set(caseId, steps);
    }
    return steps;
  };
  const attempts = new Map<number, number>();

  for (const result of results) {
    const sourceId = asText(result.hash);
    if (!sourceId || doneResults.has(sourceId)) {
      continue;
    }
    const status = asText(result.status);
    const subject =
      asText(project.caseRecords.get(String(result.case_id))?.title) ||
      sourceId.slice(0, 8);
    const run = runContexts.get(String(result.run_id));
    const caseId = caseIds.get(String(result.case_id));
    const runCaseId = run && caseId ? run.runCases.get(caseId) : undefined;
    if (!state.statuses.has(status) || !run || !caseId || !runCaseId) {
      // No result to record (untested, removed), or its run or case was not
      // imported.
      if (state.statuses.has(status)) {
        warn(state, { code: "result_skipped", subject });
        state.progress.results.failed =
          (state.progress.results.failed ?? 0) + 1;
        state.progress.results.done += 1;
      } else {
        state.progress.results.total -= 1;
      }
      continue;
    }
    try {
      let attempt = attempts.get(runCaseId);
      if (attempt === undefined) {
        attempt = await db.testRunResults.count({
          where: { testRunCaseId: runCaseId },
        });
      }
      attempt += 1;
      attempts.set(runCaseId, attempt);
      await importResult(
        state,
        project,
        result,
        run,
        runCaseId,
        attempt,
        await stepsOf(String(result.case_id), caseId),
        subject
      );
    } catch (error) {
      if (error instanceof QaseImportCanceledError) {
        throw error;
      }
      state.progress.results.failed = (state.progress.results.failed ?? 0) + 1;
      warn(state, {
        code: "result_failed",
        subject,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    state.progress.results.done += 1;
    await persist(state, "results");
  }

  // A run case shows its latest result, as it does after a result is added
  // in TestPlanIt. Worked out from the rows, so results an earlier attempt
  // imported count too.
  for (const context of runContexts.values()) {
    const recorded = await db.testRunResults.findMany({
      where: { testRunId: context.runId, isDeleted: false },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      select: {
        testRunCaseId: true,
        statusId: true,
        executedAt: true,
        elapsed: true,
        status: { select: { isCompleted: true } },
      },
    });
    const latestByRunCase = new Map<number, (typeof recorded)[number]>();
    for (const entry of recorded) {
      if (!latestByRunCase.has(entry.testRunCaseId)) {
        latestByRunCase.set(entry.testRunCaseId, entry);
      }
    }
    if (latestByRunCase.size > 0) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
        for (const [runCaseId, latest] of latestByRunCase) {
          await tx.testRunCases.update({
            where: { id: runCaseId },
            data: {
              statusId: latest.statusId,
              isCompleted: latest.status.isCompleted,
              completedAt: latest.status.isCompleted ? latest.executedAt : null,
              elapsed: latest.elapsed,
            },
          });
        }
      });
    }
    if (!context.completed) {
      // An open run is still to be worked on, so it needs its forecast.
      await updateTestRunForecast(context.runId, { dbClient: db }).catch(
        () => {}
      );
    }
  }
}
