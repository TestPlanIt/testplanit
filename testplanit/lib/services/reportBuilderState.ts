import { createHash } from "crypto";
import type { DbClient } from "~/lib/zenstack";
import type { ReportBuilderStateConfig } from "~/lib/schemas/reportBuilderStateSchema";

/**
 * Unused ReportBuilderState rows are swept after this many days without a
 * `lastUsedAt` bump. A row referenced by a ShareLink (`entityConfig.stateId`)
 * is never swept.
 */
export const REPORT_BUILDER_STATE_RETENTION_DAYS = 90;

const SWEEP_BATCH_SIZE = 1000;

/**
 * JSON with object keys sorted recursively, so two configs that differ only
 * in key order hash the same. Array order is preserved: dimension order is
 * part of the report shape.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Dedupe key for a persisted builder state: sha256 over the canonical JSON
 * of the report type plus its config.
 */
export function hashReportBuilderState(
  reportType: string,
  config: ReportBuilderStateConfig
): string {
  return createHash("sha256")
    .update(canonicalJson({ reportType, config }))
    .digest("hex");
}

export interface SweepReportBuilderStatesResult {
  deleted: number;
  cutoff: Date;
}

/**
 * Deletes ReportBuilderState rows whose lastUsedAt is older than the
 * retention window and that no ShareLink references through
 * `entityConfig.stateId`. Batched LIMIT deletes (the same idiom as the
 * webhook and DataChangeLog retention workers) keep lock time short.
 */
export async function sweepReportBuilderStates(
  client: DbClient,
  opts: { now?: Date; retentionDays?: number } = {}
): Promise<SweepReportBuilderStatesResult> {
  const now = opts.now ?? new Date();
  const retentionDays =
    opts.retentionDays ?? REPORT_BUILDER_STATE_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let deleted = 0;
  for (;;) {
    const rowsAffected = await client.$executeRaw`
      DELETE FROM "ReportBuilderState"
      WHERE id IN (
        SELECT s.id FROM "ReportBuilderState" s
        WHERE s."lastUsedAt" < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "ShareLink" l
            WHERE l."entityConfig"->>'stateId' = s.id
          )
        LIMIT ${SWEEP_BATCH_SIZE}
      )
    `;
    const n = Number(rowsAffected);
    deleted += n;
    if (n < SWEEP_BATCH_SIZE) break;
  }

  return { deleted, cutoff };
}
