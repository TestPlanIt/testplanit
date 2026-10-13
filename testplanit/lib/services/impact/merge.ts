/**
 * Merges the five selection layers into ranked, tiered ScoredCases and
 * reports which changed paths no selected case covers.
 */

import type { ImpactConfig } from "./config";
import { linkedScoreFor, pinSpecificity } from "./scoring";
import type {
  CaseTier,
  LayerResult,
  ReasonKind,
  ScoredCase,
  SelectionReason,
} from "./types";

export interface CaseLink {
  otherId: number;
  type: string;
}

export interface MergeLayersInput {
  pin: LayerResult;
  issue: LayerResult;
  path: LayerResult;
  history: LayerResult;
  ai: LayerResult;
  links: Map<number, CaseLink[]>;
  changedPaths: string[];
  cfg: ImpactConfig;
}

export interface MergeLayersOutput {
  cases: ScoredCase[];
  uncoveredFiles: string[];
}

interface Accumulated {
  score: number;
  reasons: SelectionReason[];
  coveredFiles: Set<string>;
  linkedOnly: boolean;
}

function coveredPathsOf(reason: SelectionReason): string[] {
  switch (reason.kind) {
    case "PIN":
      return reason.filePath ? [reason.filePath] : [];
    case "PATH":
      return reason.filePath ? [reason.filePath] : [];
    case "HISTORY":
      return Array.isArray(reason.overlappingPaths)
        ? reason.overlappingPaths
        : [];
    case "AI":
      return Array.isArray(reason.files) ? reason.files : [];
    case "ISSUE":
      return Array.isArray(reason.files) ? reason.files : [];
    default:
      return [];
  }
}

function layersOf(reasons: SelectionReason[]): ReasonKind[] {
  const out: ReasonKind[] = [];
  for (const reason of reasons) {
    if (!out.includes(reason.kind)) out.push(reason.kind);
  }
  return out;
}

function maxPinSpecificity(reasons: SelectionReason[]): number {
  let best = 0;
  for (const reason of reasons) {
    if (reason.kind === "PIN") {
      best = Math.max(best, pinSpecificity(reason.pinKind));
    }
  }
  return best;
}

function tierOf(score: number, hasPin: boolean, cfg: ImpactConfig): CaseTier {
  if (hasPin) return "pinned";
  return score >= cfg.affectedThreshold ? "affected" : "related";
}

export function mergeLayers(input: MergeLayersInput): MergeLayersOutput {
  const { cfg } = input;
  const acc = new Map<number, Accumulated>();

  for (const layer of [
    input.pin,
    input.issue,
    input.path,
    input.history,
    input.ai,
  ]) {
    for (const candidate of layer.values()) {
      let entry = acc.get(candidate.caseId);
      if (!entry) {
        entry = {
          score: 0,
          reasons: [],
          coveredFiles: new Set(),
          linkedOnly: false,
        };
        acc.set(candidate.caseId, entry);
      }
      entry.score = Math.max(entry.score, candidate.score);
      entry.reasons.push(...candidate.reasons);
      for (const reason of candidate.reasons) {
        for (const path of coveredPathsOf(reason)) entry.coveredFiles.add(path);
      }
    }
  }

  if (cfg.linkedExpansion) {
    const parents = [...acc.entries()].filter(([, e]) => e.score >= 60);
    for (const [parentId, parent] of parents) {
      for (const link of input.links.get(parentId) ?? []) {
        const linkedScore = linkedScoreFor(parent.score);
        const reason: SelectionReason = {
          kind: "LINKED",
          viaCaseId: parentId,
          linkType: link.type,
        };
        const existing = acc.get(link.otherId);
        if (!existing) {
          acc.set(link.otherId, {
            score: linkedScore,
            reasons: [reason],
            coveredFiles: new Set(),
            linkedOnly: true,
          });
        } else if (existing.linkedOnly) {
          existing.score = Math.max(existing.score, linkedScore);
          existing.reasons.push(reason);
        }
      }
    }
  }

  const cases: ScoredCase[] = [];
  for (const [caseId, entry] of acc) {
    const hasPin = entry.reasons.some((r) => r.kind === "PIN");
    if (entry.score < cfg.minScore && !hasPin) continue;
    cases.push({
      caseId,
      score: entry.score,
      tier: tierOf(entry.score, hasPin, cfg),
      layers: layersOf(entry.reasons),
      reasons: entry.reasons,
      coveredFiles: [...entry.coveredFiles].sort(),
    });
  }

  cases.sort(
    (a, b) =>
      b.score - a.score ||
      maxPinSpecificity(b.reasons) - maxPinSpecificity(a.reasons) ||
      b.layers.length - a.layers.length ||
      a.caseId - b.caseId
  );

  const covered = new Set<string>();
  for (const scored of cases) {
    for (const path of scored.coveredFiles) covered.add(path);
  }
  const uncoveredFiles = input.changedPaths.filter((p) => !covered.has(p));

  return { cases, uncoveredFiles };
}
