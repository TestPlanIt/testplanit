import { createHash } from "crypto";
import { resolvePriorityWeights } from "~/lib/schemas/riskPriorityWeights";
import { syncRepositoryCasesToElasticsearch } from "~/services/repositoryCaseSync";
import { computeRiskScore } from "./score";
import {
  getCaseRiskSignals,
  resolveCriticalityOptions,
  RISK_BATCH_SIZE,
  type CriticalityOptions,
} from "./signals";
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
 * Fingerprint of everything configurable that feeds a score: the component
 * weights, the priority mapping and the criticality field's roster. Stored
 * with each score so a recompute can tell "nothing changed" from "the
 * project is configured differently now" — without rewriting every case to
 * find out, and without a config change going unnoticed on cases whose
 * number happens to land the same.
 */
function computeConfigHash(
  weights: RiskWeights,
  priorityWeights: Map<string, number>,
  criticalityOptions: CriticalityOptions
): string {
  const canonical = JSON.stringify([
    RISK_COMPONENT_KEYS.map((key) => [key, weights[key]]),
    [...priorityWeights.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [...criticalityOptions.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, option]) => [id, option.name, option.weight]),
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

interface ScoringConfig {
  weights: RiskWeights;
  priorityWeights: Map<string, number>;
  criticalityFieldId: number | null;
  criticalityOptions: CriticalityOptions;
  configHash: string;
}

async function loadScoringProject(
  db: RiskDb,
  projectId: number
): Promise<ScoringConfig | null> {
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: {
      riskScoringEnabled: true,
      riskWeights: true,
      riskPriorityWeights: true,
      riskCriticalityFieldId: true,
      isDeleted: true,
    },
  });
  if (!project || project.isDeleted || !project.riskScoringEnabled) {
    return null;
  }
  const weights = resolveRiskWeights(project.riskWeights);
  const priorityWeights = resolvePriorityWeights(project.riskPriorityWeights);
  const criticalityOptions = await resolveCriticalityOptions(
    db,
    project.riskCriticalityFieldId
  );
  return {
    weights,
    priorityWeights,
    criticalityFieldId: project.riskCriticalityFieldId,
    criticalityOptions,
    configHash: computeConfigHash(weights, priorityWeights, criticalityOptions),
  };
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
    const signals = await getCaseRiskSignals(db, projectId, batch, {
      criticalityFieldId: scoring.criticalityFieldId,
      criticalityOptions: scoring.criticalityOptions,
    });
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
        scoring.priorityWeights,
        now,
        scoring.configHash
      );
      const storedFacts = (row.riskReasons as { facts?: unknown } | null)
        ?.facts;
      const storedHash = (row.riskReasons as { configHash?: unknown } | null)
        ?.configHash;
      if (
        row.riskScore === score &&
        storedHash === scoring.configHash &&
        factsEqual(storedFacts, reasons.facts)
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
