import type { JSONContent } from "@tiptap/core";
import type { JsonObject } from "@zenstackhq/orm";
import { emptyEditorContent } from "~/app/constants/backend";
import type { DbClient, TxClient } from "~/lib/zenstack";
import {
  collectQaseImageUrls,
  type QaseFieldTarget,
  type QaseFile,
} from "./content";
import type { QaseCopiedFile, QaseFileCopier } from "./files";
import type {
  QaseAnalysis,
  QaseMappingConfiguration,
  QaseSourceField,
} from "./mapping";
import type { QaseImportProgress, QaseImportWarning } from "./types";

export class QaseImportCanceledError extends Error {
  constructor() {
    super("The import from Qase was canceled.");
    this.name = "QaseImportCanceledError";
  }
}

export const MAX_WARNINGS = 300;
export const PERSIST_EVERY_MS = 1500;
export const EMPTY_DOC = emptyEditorContent as JSONContent;

export const asText = (value: unknown) =>
  typeof value === "string" ? value : "";
export const toDate = (value: unknown): Date | undefined => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};
export const fileNameOf = (url: string) => {
  try {
    return decodeURIComponent(
      new URL(url).pathname.split("/").pop() || "image"
    );
  } catch {
    return "image";
  }
};

export interface FieldPlan {
  source: QaseSourceField;
  fieldId: number;
  target: QaseFieldTarget;
}

export interface ImportState {
  db: DbClient;
  jobId: string;
  importerId: string;
  config: QaseMappingConfiguration;
  analysis: QaseAnalysis;
  progress: QaseImportProgress;
  warnings: QaseImportWarning[];
  warningKeys: Set<string>;
  lastPersist: number;
  copier: QaseFileCopier;
  userNames: Map<string, string>;
  tagIds: Map<string, number>;
  templateId: number;
  fields: FieldPlan[];
  /** TestPlanIt status by Qase result status slug. */
  statuses: Map<string, { id: number; isCompleted: boolean }>;
  /** Qase result status slug by the number step results use. */
  statusSlugs: Map<number, string>;
  /** Qase custom field definitions, for values kept as text. */
  customFields: Record<string, unknown>[];
  /** Qase user id by the author uuid results carry. */
  authorUsers: Map<string, string>;
  /** Integration id by issue tracker id: `qase` or a tracker type. */
  trackers: Map<string, number>;
}

export function warn(state: ImportState, warning: QaseImportWarning) {
  const key = `${warning.code}:${warning.subject}`;
  if (state.warningKeys.has(key) || state.warnings.length >= MAX_WARNINGS) {
    return;
  }
  state.warningKeys.add(key);
  state.warnings.push(warning);
}

export async function persist(
  state: ImportState,
  entity: string | null,
  force = false
) {
  const now = Date.now();
  if (!force && now - state.lastPersist < PERSIST_EVERY_MS) {
    return;
  }
  state.lastPersist = now;
  const counted = [
    "folders",
    "sharedSteps",
    "cases",
    "milestones",
    "runs",
    "results",
    "issues",
  ] as const;
  const updated = await state.db.qaseImportJob.update({
    where: { id: state.jobId },
    data: {
      currentEntity: entity,
      entityProgress: state.progress as unknown as JsonObject,
      activityLog: state.warnings as unknown as JsonObject[],
      processedCount: counted.reduce(
        (sum, key) => sum + state.progress[key].done,
        0
      ),
      totalCount: counted.reduce(
        (sum, key) => sum + state.progress[key].total,
        0
      ),
    },
    select: { cancelRequested: true },
  });
  if (updated.cancelRequested) {
    throw new QaseImportCanceledError();
  }
}

export async function loadMappings(
  db: DbClient,
  jobId: string,
  entity: string,
  projectCode = ""
): Promise<Map<string, string>> {
  const rows = await db.qaseImportMapping.findMany({
    where: { jobId, entity, projectCode },
    select: { sourceId: true, targetId: true },
  });
  return new Map(rows.map((row) => [row.sourceId, row.targetId]));
}

export async function remember(
  client: DbClient | TxClient,
  jobId: string,
  entity: string,
  projectCode: string,
  sourceId: string,
  targetId: string | number
) {
  await client.qaseImportMapping.create({
    data: { jobId, entity, projectCode, sourceId, targetId: String(targetId) },
  });
}

export async function resolveTag(
  state: ImportState,
  rawName: string
): Promise<number | null> {
  const name = rawName.trim().slice(0, 255);
  if (!name) {
    return null;
  }
  const key = name.toLowerCase();
  const cached = state.tagIds.get(key);
  if (cached) {
    return cached;
  }
  const existing = await state.db.tags.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, isDeleted: true },
  });
  let id: number;
  if (existing) {
    id = existing.id;
    if (existing.isDeleted) {
      await state.db.tags.update({ where: { id }, data: { isDeleted: false } });
    }
  } else {
    id = (await state.db.tags.create({ data: { name }, select: { id: true } }))
      .id;
  }
  state.tagIds.set(key, id);
  return id;
}

/** Copies the images a text refers to and returns where each now lives. */
export async function copyImages(
  state: ImportState,
  texts: unknown[],
  subject: string
): Promise<(url: string) => string | null> {
  const resolved = new Map<string, string>();
  for (const url of new Set(texts.flatMap(collectQaseImageUrls))) {
    const copied = await state.copier.copy("docimage", url, fileNameOf(url));
    if (copied) {
      resolved.set(url, copied.url);
      state.progress.files.done += 1;
    } else {
      warn(state, {
        code: "image_failed",
        subject,
        detail: state.copier.failureOf("docimage", url),
      });
    }
    state.progress.files.total += 1;
  }
  return (url) => resolved.get(url) ?? null;
}

export async function copyAttachments(
  state: ImportState,
  files: QaseFile[],
  subject: string
): Promise<{ file: QaseFile; copied: QaseCopiedFile }[]> {
  const result: { file: QaseFile; copied: QaseCopiedFile }[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.url)) {
      continue;
    }
    seen.add(file.url);
    state.progress.files.total += 1;
    const copied = await state.copier.copy(
      "attachment",
      file.url,
      file.filename,
      file.mime
    );
    if (copied) {
      state.progress.files.done += 1;
      result.push({ file, copied });
    } else {
      warn(state, {
        code: "attachment_failed",
        subject: `${subject}: ${file.filename}`,
        detail: state.copier.failureOf("attachment", file.url),
      });
    }
  }
  return result;
}

export interface ProjectContext {
  code: string;
  title: string;
  projectId: number;
  repositoryId: number;
  folderIds: Map<string, number>;
  sharedStepIds: Map<string, number>;
  fallbackFolderId: number | null;
  defaultStateId: number;
  /** The Qase case records, by Qase case id. */
  caseRecords: Map<string, Record<string, unknown>>;
}
