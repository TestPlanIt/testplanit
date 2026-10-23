import { syncRepositoryCasesToElasticsearch } from "~/services/repositoryCaseSync";
import { computeRiskScore } from "./score";
import { getCaseRiskSignals, RISK_BATCH_SIZE } from "./signals";
import type { RiskDb, RiskFacts, RiskWeights } from "./types";
import { RISK_COMPONENT_KEYS } from "./types";
import { resolveRiskWeights } from "./weights";

export interface RiskUpdateOptions {
  now?: Date;
  tenantId?: string;
}

export interface RiskUpdateResult {
  scanned: number;
  updated: number;
}

/** Stored facts arrive as jsonb (key order not preserved), so compare fields. */
function factsEqual(stored: unknown, next: RiskFacts): boolean {
  if (!stored || typeof stored !== "object") return false;
  const previous = stored as Record<string, unknown>;
  return (Object.keys(next) as (keyof RiskFacts)[]).every(
    (key) => previous[key] === next[key]
  );
}

/**
 * True when the stored breakdown was computed with the same weights: a
 * weight change must rewrite even score-identical rows, or the persisted
 * per-component breakdown keeps describing the old configuration.
 */
function weightsMatch(storedReasons: unknown, weights: RiskWeights): boolean {
  const components = (storedReasons as { components?: unknown } | null)
    ?.components;
  if (
    !Array.isArray(components) ||
    components.length !== RISK_COMPONENT_KEYS.length
  ) {
    return false;
  }
  const byKey = new Map(
    components.map((component) => [
      (component as { key?: unknown }).key,
      (component as { weight?: unknown }).weight,
    ])
  );
  return RISK_COMPONENT_KEYS.every((key) => byKey.get(key) === weights[key]);
}

async function loadScoringProject(
  db: RiskDb,
  projectId: number
): Promise<{ weights: RiskWeights } | null> {
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: { riskScoringEnabled: true, riskWeights: true, isDeleted: true },
  });
  if (!project || project.isDeleted || !project.riskScoringEnabled) {
    return null;
  }
  return { weights: resolveRiskWeights(project.riskWeights) };
}

/**
 * Recomputes the risk score for the given cases of one project and persists
 * changed scores. Writes go through the raw client the caller hands in, so
 * the sideEffectsPlugin never fires — which is why changed cases are bulk
 * re-indexed to Elasticsearch here (the forecast precedent syncs per case;
 * risk batches). Unchanged cases cost no write and no sync, and the risk
 * columns are audit-denylisted, so a recompute writes no DataChangeLog rows.
 */
export async function updateRiskScoresForCases(
  db: RiskDb,
  projectId: number,
  caseIds: number[],
  options: RiskUpdateOptions = {}
): Promise<RiskUpdateResult> {
  const result: RiskUpdateResult = { scanned: 0, updated: 0 };
  if (caseIds.length === 0) return result;
  const scoring = await loadScoringProject(db, projectId);
  if (!scoring) return result;
  const now = options.now ?? new Date();

  for (let i = 0; i < caseIds.length; i += RISK_BATCH_SIZE) {
    const batch = caseIds.slice(i, i + RISK_BATCH_SIZE);
    const signals = await getCaseRiskSignals(db, projectId, batch);
    if (signals.size === 0) continue;
    const currentRows = await db.repositoryCases.findMany({
      where: { id: { in: [...signals.keys()] } },
      select: { id: true, riskScore: true, riskReasons: true },
    });
    const changedIds: number[] = [];
    for (const row of currentRows) {
      const caseSignals = signals.get(row.id);
      if (!caseSignals) continue;
      result.scanned++;
      const { score, reasons } = computeRiskScore(
        caseSignals,
        scoring.weights,
        now
      );
      const storedFacts = (row.riskReasons as { facts?: unknown } | null)
        ?.facts;
      if (
        row.riskScore === score &&
        factsEqual(storedFacts, reasons.facts) &&
        weightsMatch(row.riskReasons, scoring.weights)
      ) {
        continue;
      }
      await db.repositoryCases.update({
        where: { id: row.id },
        data: {
          riskScore: score,
          riskReasons: reasons,
          riskComputedAt: now,
        },
      });
      changedIds.push(row.id);
      result.updated++;
    }
    if (changedIds.length > 0) {
      await syncRepositoryCasesToElasticsearch(
        changedIds,
        options.tenantId,
        db as Parameters<typeof syncRepositoryCasesToElasticsearch>[2]
      ).catch((error: unknown) => {
        console.error(
          "[risk-score] Elasticsearch sync failed for cases %s:",
          changedIds.join(", "),
          error
        );
      });
    }
  }
  return result;
}

/**
 * Full-project recompute (nightly sweep and the settings backfill): drains
 * live cases in id order, `RISK_BATCH_SIZE` at a time.
 */
export async function updateProjectRiskScores(
  db: RiskDb,
  projectId: number,
  options: RiskUpdateOptions & {
    onBatch?: (progress: RiskUpdateResult) => Promise<void> | void;
  } = {}
): Promise<RiskUpdateResult> {
  const result: RiskUpdateResult = { scanned: 0, updated: 0 };
  let cursor = 0;
  for (;;) {
    const rows = await db.repositoryCases.findMany({
      where: {
        projectId,
        isDeleted: false,
        isArchived: false,
        id: { gt: cursor },
      },
      orderBy: { id: "asc" },
      take: RISK_BATCH_SIZE,
      select: { id: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    const batch = await updateRiskScoresForCases(
      db,
      projectId,
      rows.map((row) => row.id),
      options
    );
    result.scanned += batch.scanned;
    result.updated += batch.updated;
    if (options.onBatch) await options.onBatch({ ...result });
    if (rows.length < RISK_BATCH_SIZE) break;
  }
  return result;
}
