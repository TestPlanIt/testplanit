import micromatch from "micromatch";

import type { DiffHunk } from "~/lib/integrations/diff/parseUnifiedDiff";

import { locateSymbolBlock, wholeWordPattern } from "./symbolScan";

export { locateSymbolBlock, symbolCandidates } from "./symbolScan";

export type CodePinKind = "FILE" | "RANGE" | "SYMBOL" | "GLOB";

export interface PinMatchInput {
  id: number;
  kind: CodePinKind;
  filePath: string;
  startLine?: number | null;
  endLine?: number | null;
  symbol?: string | null;
  anchorSha?: string | null;
  anchorSnippet?: string | null;
  staleDismissedAt?: Date | string | null;
}

export interface DiffFileForMatch {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  isBinary: boolean;
  hunks: DiffHunk[];
  patch?: string;
}

export type StaleReason =
  | "FILE_DELETED"
  | "FILE_RENAMED"
  | "FILE_MISSING_AT_BASE"
  | "SNIPPET_NOT_FOUND"
  | "SYMBOL_NOT_FOUND";

export type MatchConfidence =
  "exact" | "normalized" | "fuzzy" | "file" | "glob";

export interface PinMatchOutcome {
  pinId: number;
  matched: boolean;
  stale: boolean;
  staleReason?: StaleReason;
  staleDismissed: boolean;
  confidence: MatchConfidence;
  matchedPath?: string;
  relocatedRange?: [number, number];
  touchedRanges?: Array<[number, number]>;
  suggestedPath?: string;
}

export interface PinMatchContext {
  baseSha: string;
  getBaseFile(path: string): Promise<string | null>;
}

export interface SnippetLocation {
  start: number;
  end: number;
  confidence: "exact" | "normalized" | "fuzzy";
}

type Draft = Omit<PinMatchOutcome, "pinId" | "staleDismissed">;
type BaseFileLoader = (path: string) => Promise<string | null>;

const GLOB_OPTIONS = { dot: true };
const FUZZY_THRESHOLD = 0.6;

function globMatches(path: string, pattern: string): boolean {
  return micromatch([path], pattern, GLOB_OPTIONS).length > 0;
}
const EDGE_LINES = 3;
const EDGE_MIN_SNIPPET = 6;

/**
 * Resolve every pin against a base..head diff. Pure: the only I/O is the
 * caller-supplied `getBaseFile`, which is invoked at most once per path.
 */
export async function matchPins(
  pins: PinMatchInput[],
  files: DiffFileForMatch[],
  ctx: PinMatchContext
): Promise<PinMatchOutcome[]> {
  const byPath = new Map<string, DiffFileForMatch>();
  const byPreviousPath = new Map<string, DiffFileForMatch>();
  for (const file of files) {
    if (!byPath.has(file.path)) byPath.set(file.path, file);
    if (file.previousPath && !byPreviousPath.has(file.previousPath)) {
      byPreviousPath.set(file.previousPath, file);
    }
  }

  const baseCache = new Map<string, Promise<string | null>>();
  const loadBase: BaseFileLoader = (path) => {
    let pending = baseCache.get(path);
    if (!pending) {
      pending = Promise.resolve().then(() => ctx.getBaseFile(path));
      baseCache.set(path, pending);
    }
    return pending;
  };

  return Promise.all(
    pins.map(async (pin) => {
      const draft = await evaluatePin(
        pin,
        files,
        byPath.get(pin.filePath) ?? byPreviousPath.get(pin.filePath),
        ctx,
        loadBase
      );
      return {
        pinId: pin.id,
        ...draft,
        staleDismissed: draft.stale && pin.staleDismissedAt != null,
      };
    })
  );
}

async function evaluatePin(
  pin: PinMatchInput,
  files: DiffFileForMatch[],
  entry: DiffFileForMatch | undefined,
  ctx: PinMatchContext,
  loadBase: BaseFileLoader
): Promise<Draft> {
  if (pin.kind === "GLOB") {
    const hits = files.filter(
      (file) =>
        globMatches(file.path, pin.filePath) ||
        (file.previousPath != null &&
          globMatches(file.previousPath, pin.filePath))
    );
    return {
      matched: hits.length > 0,
      stale: false,
      confidence: "glob",
      ...(hits.length > 0 ? { matchedPath: hits[0].path } : {}),
    };
  }

  if (!entry) return { matched: false, stale: false, confidence: "file" };

  if (entry.status === "deleted") {
    return {
      matched: true,
      stale: true,
      staleReason: "FILE_DELETED",
      confidence: "file",
      matchedPath: entry.path,
    };
  }

  const draft = await evaluateContent(pin, entry, ctx, loadBase);
  const renamed =
    entry.previousPath === pin.filePath && entry.path !== pin.filePath;
  if (renamed) {
    draft.stale = true;
    draft.staleReason = "FILE_RENAMED";
    draft.suggestedPath = entry.path;
  }
  return draft;
}

async function evaluateContent(
  pin: PinMatchInput,
  entry: DiffFileForMatch,
  ctx: PinMatchContext,
  loadBase: BaseFileLoader
): Promise<Draft> {
  const fileLevel: Draft = {
    matched: true,
    stale: false,
    confidence: "file",
    matchedPath: entry.path,
  };
  if (pin.kind === "FILE" || entry.isBinary) return fileLevel;

  const basePath = entry.previousPath ?? pin.filePath;

  if (pin.kind === "RANGE") {
    let range: [number, number];
    let confidence: MatchConfidence;
    if (
      pin.anchorSha &&
      pin.anchorSha === ctx.baseSha &&
      pin.startLine != null
    ) {
      const end = pin.endLine ?? pin.startLine;
      range = [Math.min(pin.startLine, end), Math.max(pin.startLine, end)];
      confidence = "exact";
    } else {
      const base = await loadBase(basePath);
      if (base === null) {
        return {
          ...fileLevel,
          stale: true,
          staleReason: "FILE_MISSING_AT_BASE",
        };
      }
      const loc = locateSnippet(
        splitLines(base),
        splitLines(pin.anchorSnippet ?? ""),
        pin.startLine ?? undefined
      );
      if (!loc) {
        return { ...fileLevel, stale: true, staleReason: "SNIPPET_NOT_FOUND" };
      }
      range = [loc.start, loc.end];
      confidence = loc.confidence;
    }
    const touched = rangesIntersect(range, entry.hunks);
    return {
      matched: touched.length > 0,
      stale: false,
      confidence,
      matchedPath: entry.path,
      relocatedRange: range,
      touchedRanges: touched,
    };
  }

  const symbol = (pin.symbol ?? "").trim();
  if (!symbol) return fileLevel;

  const base = await loadBase(basePath);
  if (base === null) {
    return { ...fileLevel, stale: true, staleReason: "FILE_MISSING_AT_BASE" };
  }
  const block = locateSymbolBlock(splitLines(base), symbol);
  if (!block) {
    const mentioned =
      entry.patch != null && wholeWordPattern(symbol).test(entry.patch);
    return {
      matched: mentioned,
      stale: true,
      staleReason: "SYMBOL_NOT_FOUND",
      confidence: "fuzzy",
      matchedPath: entry.path,
    };
  }
  const touched = rangesIntersect(block, entry.hunks);
  return {
    matched: touched.length > 0,
    stale: false,
    confidence: "fuzzy",
    matchedPath: entry.path,
    relocatedRange: block,
    touchedRanges: touched,
  };
}

/**
 * Find where `snippetLines` sits inside `baseLines`. Tries an exact match,
 * then a whitespace-normalized one, then a fuzzy window; `hint` (1-based)
 * breaks ties toward the pin's original start line. Returns 1-based lines.
 */
export function locateSnippet(
  baseLines: string[],
  snippetLines: string[],
  hint?: number
): SnippetLocation | null {
  const snippet = snippetLines.slice();
  if (snippet.length > 0 && snippet[snippet.length - 1] === "") snippet.pop();
  const n = snippet.length;
  if (n === 0 || baseLines.length < n) return null;

  const target = hint != null && Number.isFinite(hint) ? hint - 1 : null;
  const distance = (i: number) => (target === null ? 0 : Math.abs(i - target));

  const exact = bestWindow(baseLines, snippet, distance);
  if (exact !== -1)
    return { start: exact + 1, end: exact + n, confidence: "exact" };

  const normBase = baseLines.map(normalizeLine);
  const normSnippet = snippet.map(normalizeLine);
  const normalized = bestWindow(normBase, normSnippet, distance);
  if (normalized !== -1) {
    return {
      start: normalized + 1,
      end: normalized + n,
      confidence: "normalized",
    };
  }

  let best = -1;
  let bestScore = 0;
  for (let i = 0; i + n <= normBase.length; i++) {
    let hits = 0;
    for (let j = 0; j < n; j++) {
      if (normBase[i + j] === normSnippet[j]) hits++;
    }
    const score = hits / n;
    const edges =
      n >= EDGE_MIN_SNIPPET && edgesMatch(normBase, normSnippet, i, n);
    if (score < FUZZY_THRESHOLD && !edges) continue;
    if (
      best === -1 ||
      score > bestScore ||
      (score === bestScore && distance(i) < distance(best))
    ) {
      best = i;
      bestScore = score;
    }
  }
  if (best === -1) return null;
  return { start: best + 1, end: best + n, confidence: "fuzzy" };
}

function bestWindow(
  lines: string[],
  snippet: string[],
  distance: (i: number) => number
): number {
  const n = snippet.length;
  let best = -1;
  for (let i = 0; i + n <= lines.length; i++) {
    if (lines[i] !== snippet[0]) continue;
    let ok = true;
    for (let j = 1; j < n; j++) {
      if (lines[i + j] !== snippet[j]) {
        ok = false;
        break;
      }
    }
    if (ok && (best === -1 || distance(i) < distance(best))) best = i;
  }
  return best;
}

function edgesMatch(
  lines: string[],
  snippet: string[],
  start: number,
  n: number
): boolean {
  for (let j = 0; j < EDGE_LINES; j++) {
    if (lines[start + j] !== snippet[j]) return false;
    const tail = n - 1 - j;
    if (lines[start + tail] !== snippet[tail]) return false;
  }
  return true;
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Old-side changed ranges from `hunks` that overlap the 1-based `range`. */
export function rangesIntersect(
  range: [number, number],
  hunks: DiffHunk[]
): Array<[number, number]> {
  const s = Math.min(range[0], range[1]);
  const e = Math.max(range[0], range[1]);
  const out: Array<[number, number]> = [];
  for (const hunk of hunks) {
    for (const [a, b] of hunk.changedOldRanges) {
      if (b >= s && a <= e) out.push([a, b]);
    }
  }
  return out;
}
