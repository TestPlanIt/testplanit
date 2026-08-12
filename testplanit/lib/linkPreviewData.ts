import type { baseDb } from "~/lib/db";
import type { PreviewEntity } from "~/lib/linkPreview";
import { formatRecordKey, type RecordType } from "~/lib/recordKey";
import { readRecordKeyConfig } from "~/lib/services/recordKeyConfig";

/**
 * Server-side record lookup behind link previews and page titles.
 *
 * Deliberately client-agnostic: page metadata passes a policy-enforced client
 * bound to the signed-in user, while `/api/link-preview` in `names` mode passes
 * the base client because an unfurl fetch has no user to enforce against. The
 * caller owns that decision — nothing here widens access on its own.
 */

/** Structural shape shared by the base client and a `$setAuth` policy client. */
type PreviewDb = typeof baseDb;

export interface EntityPreview {
  /** The record's own name. */
  name: string;
  /** Owning project name, or null for a project preview (it *is* the project). */
  projectName: string | null;
  /** Display key ("ACME-TC-1234") when record keys are enabled, else null. */
  recordKey: string | null;
  caseCount: number | null;
  runCount: number | null;
}

/** Maps a previewable route kind onto its record-key type token. */
const RECORD_TYPE_BY_ENTITY: Partial<Record<PreviewEntity, RecordType>> = {
  "test-case": "TEST_CASE",
  "test-run": "TEST_RUN",
  session: "SESSION",
  milestone: "MILESTONE",
};

/**
 * Derive the cosmetic display key for a record, matching what the app shows in
 * its own UI. Returns null when the feature is off or the project has no key,
 * which is the same fallback the rest of the app uses.
 */
async function deriveRecordKey(
  db: PreviewDb,
  entity: PreviewEntity,
  id: number,
  projectKey: string | null | undefined
): Promise<string | null> {
  const type = RECORD_TYPE_BY_ENTITY[entity];
  if (!type || !projectKey) return null;

  const { enabled, tokens } = await readRecordKeyConfig(db);
  if (!enabled) return null;

  return formatRecordKey({ projectKey, type, id, tokens });
}

/**
 * Load the display fields for a previewable record.
 *
 * Returns null when the record does not exist, is soft-deleted, or — for a
 * policy-enforced client — the caller cannot read it. Callers treat null as
 * "fall back to the generic card", never as an error.
 */
export async function loadEntityPreview(
  db: PreviewDb,
  entity: PreviewEntity,
  id: number
): Promise<EntityPreview | null> {
  try {
    switch (entity) {
      case "test-case": {
        const record = await db.repositoryCases.findUnique({
          where: { id },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true, key: true } },
          },
        });
        if (!record || record.isDeleted) return null;
        return {
          name: record.name,
          projectName: record.project?.name ?? null,
          recordKey: await deriveRecordKey(db, entity, id, record.project?.key),
          caseCount: null,
          runCount: null,
        };
      }

      case "test-run": {
        const record = await db.testRuns.findUnique({
          where: { id },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true, key: true } },
            _count: { select: { testCases: { where: { isDeleted: false } } } },
          },
        });
        if (!record || record.isDeleted) return null;
        return {
          name: record.name,
          projectName: record.project?.name ?? null,
          recordKey: await deriveRecordKey(db, entity, id, record.project?.key),
          caseCount: record._count.testCases,
          runCount: null,
        };
      }

      case "session": {
        const record = await db.sessions.findUnique({
          where: { id },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true, key: true } },
          },
        });
        if (!record || record.isDeleted) return null;
        return {
          name: record.name,
          projectName: record.project?.name ?? null,
          recordKey: await deriveRecordKey(db, entity, id, record.project?.key),
          caseCount: null,
          runCount: null,
        };
      }

      case "milestone": {
        const record = await db.milestones.findUnique({
          where: { id },
          select: {
            name: true,
            isDeleted: true,
            project: { select: { name: true, key: true } },
          },
        });
        if (!record || record.isDeleted) return null;
        return {
          name: record.name,
          projectName: record.project?.name ?? null,
          recordKey: await deriveRecordKey(db, entity, id, record.project?.key),
          caseCount: null,
          runCount: null,
        };
      }

      case "project": {
        const record = await db.projects.findUnique({
          where: { id },
          select: {
            name: true,
            isDeleted: true,
            _count: {
              select: {
                repositoryCases: { where: { isDeleted: false } },
                testRuns: { where: { isDeleted: false } },
              },
            },
          },
        });
        if (!record || record.isDeleted) return null;
        return {
          name: record.name,
          projectName: null,
          recordKey: null,
          caseCount: record._count.repositoryCases,
          runCount: record._count.testRuns,
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error("Link preview lookup failed:", error);
    return null;
  }
}
