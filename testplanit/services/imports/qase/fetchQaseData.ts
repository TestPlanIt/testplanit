import type { JsonObject } from "@zenstackhq/orm";
import type { DbClient } from "~/lib/zenstack";
import {
  QASE_PROJECT_ENTITIES,
  QASE_WORKSPACE_ENTITIES,
  type QaseEntityDefinition,
} from "./entities";
import type { QaseClient } from "./qaseClient";
import type { QaseFetchProgress } from "./types";

export class QaseFetchCanceledError extends Error {
  constructor() {
    super("The fetch from Qase was canceled.");
    this.name = "QaseFetchCanceledError";
  }
}

export interface FetchQaseDataOptions {
  db: DbClient;
  client: QaseClient;
  jobId: string;
  projectCodes: string[];
  /** Called after every page; throwing stops the fetch. */
  onProgress?: (
    progress: QaseFetchProgress,
    currentEntity: string
  ) => Promise<void>;
  isCanceled?: () => Promise<boolean>;
}

type QaseRecord = Record<string, unknown>;

function sourceIdOf(
  record: QaseRecord,
  definition: QaseEntityDefinition,
  fallback: number
): string {
  const value = record[definition.idKey];
  return value === undefined || value === null ? `#${fallback}` : String(value);
}

/**
 * Copies every record of the selected Qase projects into the staging table,
 * replacing whatever an earlier attempt of the same job left there.
 */
export async function fetchQaseData(
  options: FetchQaseDataOptions
): Promise<QaseFetchProgress> {
  const { db, client, jobId, projectCodes, onProgress, isCanceled } = options;

  await db.qaseImportStaging.deleteMany({ where: { jobId } });

  const progress: QaseFetchProgress = {};
  for (const definition of [
    ...QASE_WORKSPACE_ENTITIES,
    ...QASE_PROJECT_ENTITIES,
  ]) {
    progress[definition.entity] = { fetched: 0, total: null, done: false };
  }

  const report = async (entity: string) => {
    if (isCanceled && (await isCanceled())) {
      throw new QaseFetchCanceledError();
    }
    await onProgress?.(progress, entity);
  };

  const stage = async (
    definition: QaseEntityDefinition,
    projectCode: string | null,
    records: QaseRecord[]
  ) => {
    if (records.length === 0) {
      return;
    }
    const entry = progress[definition.entity];
    await db.qaseImportStaging.createMany({
      data: records.map((record, index) => ({
        jobId,
        projectCode,
        entity: definition.entity,
        sourceId: sourceIdOf(record, definition, entry.fetched + index),
        rowIndex: entry.fetched + index,
        data: record as JsonObject,
      })),
    });
    entry.fetched += records.length;
  };

  // A defect lists its attachments by hash only; the import needs where each
  // file is, as cases and results give it.
  const attachmentsByHash = new Map<string, QaseRecord | null>();
  const resolveAttachments = async (records: QaseRecord[]) => {
    for (const record of records) {
      if (!Array.isArray(record.attachments)) {
        continue;
      }
      const resolved: QaseRecord[] = [];
      for (const attachment of record.attachments as QaseRecord[]) {
        const hash =
          typeof attachment?.hash === "string" ? attachment.hash : "";
        if (!hash || typeof attachment.url === "string") {
          resolved.push(attachment);
          continue;
        }
        if (!attachmentsByHash.has(hash)) {
          attachmentsByHash.set(
            hash,
            await client
              .get<QaseRecord>(`attachment/${encodeURIComponent(hash)}`)
              .catch(() => null)
          );
        }
        const details = attachmentsByHash.get(hash);
        const url = details?.full_path ?? details?.url;
        resolved.push(
          details && typeof url === "string"
            ? {
                ...attachment,
                url,
                filename: details.file,
                mime: details.mime,
                size: details.size,
              }
            : attachment
        );
      }
      record.attachments = resolved;
    }
  };

  const fetchEntity = async (
    definition: QaseEntityDefinition,
    projectCode: string | null,
    totals: number[]
  ) => {
    const path = definition.path.replace(
      "{code}",
      encodeURIComponent(projectCode ?? "")
    );

    if (definition.paged === false) {
      const records = await client.get<QaseRecord[]>(path, definition.query);
      const list = Array.isArray(records) ? records : [];
      totals.push(list.length);
      await stage(definition, projectCode, list);
      await report(definition.entity);
      return;
    }

    let counted = false;
    for await (const page of client.pages<QaseRecord>(path, definition.query)) {
      if (!counted) {
        totals.push(page.total);
        counted = true;
      }
      if (definition.entity === "defect") {
        await resolveAttachments(page.entities);
      }
      await stage(definition, projectCode, page.entities);
      await report(definition.entity);
    }
  };

  for (const definition of QASE_WORKSPACE_ENTITIES) {
    const totals: number[] = [];
    await report(definition.entity);
    await fetchEntity(definition, null, totals);
    progress[definition.entity].total = totals[0] ?? 0;
    progress[definition.entity].done = true;
  }

  for (const definition of QASE_PROJECT_ENTITIES) {
    const totals: number[] = [];
    await report(definition.entity);
    for (const projectCode of projectCodes) {
      await fetchEntity(definition, projectCode, totals);
    }
    progress[definition.entity].total = totals.reduce(
      (sum, value) => sum + value,
      0
    );
    progress[definition.entity].done = true;
  }

  return progress;
}
