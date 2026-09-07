import {
  matchPins,
  type CodePinKind,
  type DiffFileForMatch,
  type PinMatchContext,
} from "../pinMatcher";
import type {
  LayerCandidate,
  LayerResult,
  PinReason,
  StalePin,
} from "../types";

export interface PinRow {
  id: number;
  caseId: number;
  kind: CodePinKind;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  anchorSha: string | null;
  anchorSnippet: string | null;
  staleDismissedAt: Date | string | null;
  source: "MANUAL" | "AI" | "ANNOTATION" | "MAPFILE";
}

export interface PinLayerOutput {
  layer: LayerResult;
  stalePins: StalePin[];
  matchedPinCount: number;
}

export const PIN_SCORE = 100;

/**
 * Layer 0: every pin the diff touches puts its case in at score 100. Stale
 * pins are reported separately; a stale pin that still matched at file level
 * is both selected and flagged for re-anchoring.
 */
export async function runPinLayer(
  pins: PinRow[],
  files: DiffFileForMatch[],
  ctx: PinMatchContext
): Promise<PinLayerOutput> {
  const layer: LayerResult = new Map();
  const stalePins: StalePin[] = [];
  if (pins.length === 0) return { layer, stalePins, matchedPinCount: 0 };

  const byId = new Map(pins.map((pin) => [pin.id, pin]));
  const outcomes = await matchPins(pins, files, ctx);
  let matchedPinCount = 0;

  for (const outcome of outcomes) {
    const pin = byId.get(outcome.pinId);
    if (!pin) continue;

    if (outcome.stale && !outcome.staleDismissed) {
      stalePins.push({
        pinId: pin.id,
        caseId: pin.caseId,
        filePath: pin.filePath,
        pinKind: pin.kind,
        reason: outcome.staleReason ?? "STALE",
        ...(outcome.suggestedPath
          ? { suggestedPath: outcome.suggestedPath }
          : {}),
      });
    }
    if (!outcome.matched) continue;
    matchedPinCount++;

    const reason: PinReason = {
      kind: "PIN",
      pinId: pin.id,
      filePath: outcome.matchedPath ?? pin.filePath,
      pinKind: pin.kind,
      source: pin.source,
      confidence: outcome.confidence,
      ...(outcome.relocatedRange
        ? { lines: outcome.relocatedRange }
        : pin.startLine
          ? {
              lines: [pin.startLine, pin.endLine ?? pin.startLine] as [
                number,
                number,
              ],
            }
          : {}),
      ...(pin.symbol ? { symbol: pin.symbol } : {}),
      ...(outcome.touchedRanges?.length
        ? { touchedRanges: outcome.touchedRanges }
        : {}),
      ...(outcome.stale
        ? { stale: true, staleReason: outcome.staleReason }
        : {}),
    };

    const existing: LayerCandidate | undefined = layer.get(pin.caseId);
    if (existing) {
      existing.reasons.push(reason);
    } else {
      layer.set(pin.caseId, {
        caseId: pin.caseId,
        score: PIN_SCORE,
        reasons: [reason],
      });
    }
  }

  return { layer, stalePins, matchedPinCount };
}
