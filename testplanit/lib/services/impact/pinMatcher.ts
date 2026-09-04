import micromatch from "micromatch";

import type { DiffHunk } from "~/lib/integrations/diff/parseUnifiedDiff";

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
const BRACE_SCAN_CAP = 2000;
const SIGNATURE_SCAN_CAP = 60;

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

const DECL_KEYWORDS =
  "function|def\\w*|class|fn|func|fun|const|let|var|val|interface|type|struct|enum|trait|impl|mod|module|object|record|protocol|extension|sub|proc|macro|typedef|namespace|union|template|export|declare|static|async|public|private|protected|internal|abstract|override|readonly|final|pub|extern|inline|unsafe|virtual|constexpr|void|int|bool|char|float|double|long|short|unsigned|signed|auto";
const DECL_MIDDLE =
  "(?:(?!\\b(?:extends|implements|throws|with|for)\\b)[^;{}=():])*?";
const SYMBOL_BOUNDARY_BEFORE = "(?<![\\w$.]|->)";
const SYMBOL_BOUNDARY_AFTER = "(?![\\w$])";
const STRICT_TERMINATOR =
  "(?:\\(|=(?![=>])|:(?!:)|\\{|<(?![=<])|\\[|->|\\s*(?:extends|implements|where|struct|interface|do|func|map|chan)\\b|$)";
const LOOSE_TERMINATOR =
  "(?:\\(|=(?![=>])|:(?!:)|\\{|<(?![=<])|\\s*(?:extends|implements)\\b)";
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#(?!\s*(?:define|\[))|--)/;
const NON_DECL_LINE =
  /^\s*(?:return|await|yield|throw|new|if|else|elif|elsif|unless|while|for|switch|match|select|loop|case|when|guard|try|catch|import|from|require|use|using|include|package|delete|typeof|defer|go|raise|panic|print|console|expect|assert)\b/;
const BLOCK_CLOSER_LINE =
  /^(?:endfunction|endmodule|endclass|endif|end|esac|done|fi|\}|\)|\])[^\w]*$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWordPattern(symbol: string): RegExp {
  return new RegExp(`(?<![\\w$])${escapeRegExp(symbol)}(?![\\w$])`);
}

function stripLiterals(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\*.*?\*\//g, " ")
    .replace(/\/\/.*$/, "")
    .replace(/\s#\s.*$/, "");
}

function indentOf(line: string): number {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  return leading.replace(/\t/g, "    ").length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function findDeclarationLine(lines: string[], symbol: string): number {
  const sym = escapeRegExp(symbol);
  const strict = new RegExp(
    `(?<![\\w.$])(?:(?:${DECL_KEYWORDS})\\b${DECL_MIDDLE}|func\\s*\\([^)]*\\)\\s*)${SYMBOL_BOUNDARY_BEFORE}${sym}${SYMBOL_BOUNDARY_AFTER}\\s*${STRICT_TERMINATOR}`
  );
  const loose = new RegExp(
    `${SYMBOL_BOUNDARY_BEFORE}${sym}${SYMBOL_BOUNDARY_AFTER}\\s*${LOOSE_TERMINATOR}`
  );

  const candidates: string[] = [];
  for (const line of lines) {
    candidates.push(
      COMMENT_LINE.test(line) || NON_DECL_LINE.test(line)
        ? ""
        : stripLiterals(line)
    );
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && strict.test(candidates[i])) return i;
  }
  for (let i = 0; i < candidates.length; i++) {
    const text = candidates[i];
    if (!text || text.trimEnd().endsWith(";")) continue;
    if (loose.test(text)) return i;
  }
  return -1;
}

function findSignatureEnd(lines: string[], decl: number): number {
  let depth = 0;
  const limit = Math.min(lines.length, decl + SIGNATURE_SCAN_CAP);
  for (let i = decl; i < limit; i++) {
    for (const ch of stripLiterals(lines[i])) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth <= 0) return i;
  }
  return decl;
}

function opensBraceBlock(
  lines: string[],
  decl: number,
  sigEnd: number
): boolean {
  let depth = 0;
  for (let i = decl; i <= sigEnd; i++) {
    for (const ch of stripLiterals(lines[i])) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
  }
  if (depth > 0) return true;

  const declIndent = indentOf(lines[decl]);
  const limit = Math.min(lines.length - 1, sigEnd + 2);
  for (let i = sigEnd + 1; i <= limit; i++) {
    const text = stripLiterals(lines[i]).trim();
    if (text.startsWith("{")) return true;
    let net = 0;
    for (const ch of text) {
      if (ch === "{") net++;
      else if (ch === "}") net--;
    }
    if (
      net > 0 &&
      indentOf(lines[i]) > declIndent &&
      !text.includes("=") &&
      !/^(?:return|yield)\b/.test(text)
    ) {
      return true;
    }
  }
  return false;
}

function balanceBraces(lines: string[], decl: number): number {
  let depth = 0;
  let armed = false;
  const limit = Math.min(lines.length, decl + BRACE_SCAN_CAP + 1);
  for (let i = decl; i < limit; i++) {
    for (const ch of stripLiterals(lines[i])) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (armed && depth <= 0) return i;
      }
    }
    if (depth > 0) armed = true;
  }
  return -1;
}

function indentationBlockEnd(
  lines: string[],
  decl: number,
  sigEnd: number
): number {
  const declIndent = indentOf(lines[decl]);
  let end = sigEnd;
  for (let i = sigEnd + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) <= declIndent) {
      if (
        end > sigEnd &&
        indentOf(lines[i]) === declIndent &&
        BLOCK_CLOSER_LINE.test(stripLiterals(lines[i]).trim())
      ) {
        end = i;
      }
      break;
    }
    end = i;
  }
  return end;
}

/**
 * Find the declaration of `symbol` and the extent of its block. Brace
 * languages are balanced from the declaration; indentation languages take
 * every following line indented deeper than the declaration. 1-based.
 */
export function locateSymbolBlock(
  lines: string[],
  symbol: string
): [number, number] | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const decl = findDeclarationLine(lines, trimmed);
  if (decl === -1) return null;

  const sigEnd = findSignatureEnd(lines, decl);
  if (opensBraceBlock(lines, decl, sigEnd)) {
    const closer = balanceBraces(lines, decl);
    if (closer !== -1) return [decl + 1, closer + 1];
  }
  return [decl + 1, indentationBlockEnd(lines, decl, sigEnd) + 1];
}

const MAX_SYMBOL_CANDIDATES = 500;

/** The strict declaration pattern with the symbol itself left open to capture. */
const DECL_CAPTURE = new RegExp(
  `(?<![\\w.$])(?:(?:${DECL_KEYWORDS})\\b${DECL_MIDDLE}|func\\s*\\([^)]*\\)\\s*)${SYMBOL_BOUNDARY_BEFORE}([A-Za-z_$][\\w$]*)${SYMBOL_BOUNDARY_AFTER}\\s*${STRICT_TERMINATOR}`
);

/** Keywords in their own right, never a declared name. `def\w*` loses its tail. */
const DECL_KEYWORD_SET = new Set(
  DECL_KEYWORDS.split("|").map((keyword) => keyword.replace(/\\w\*$/, ""))
);

/** Keywords that introduce something with a body: functions, classes, types. */
const BLOCK_KEYWORD =
  /\b(?:function|def\w*|class|fn|func|fun|interface|type|struct|enum|trait|impl|mod|module|object|record|protocol|extension|namespace|template|typedef|union|sub|proc|macro)\b/;

/**
 * `= () => …` and `= function …`: a value binding that is really a function.
 *
 * An awaited value is excluded even when an arrow appears later on the line,
 * which is how `const data = await res.json().catch(() => ({}))` reads.
 */
const FUNCTION_VALUE = /=(?!\s*await\b)\s*(?:async\s+)?(?:function\b|[^;]*=>)/;

/**
 * Whether the declaration on this line has a body worth pinning.
 *
 * A SYMBOL pin means "this case covers that unit of code", so a plain value
 * binding is a poor target: `locateSymbolBlock` resolves it to its single
 * line, and a pin that narrow rarely intersects a diff in a useful way.
 */
function opensBlock(line: string): boolean {
  return BLOCK_KEYWORD.test(line) || FUNCTION_VALUE.test(line);
}

/**
 * Declared names a SYMBOL pin can anchor to, in the order they appear.
 *
 * Built from the same strict pattern `findDeclarationLine` searches with, so
 * every name returned is one `locateSymbolBlock` finds again. That is the
 * whole point: a picker fed from a looser source would offer symbols the
 * matcher then rejects. Names only the looser second pass would find are left
 * out, which costs completeness and keeps the guarantee.
 *
 * Only declarations with a body are listed. Function-local bindings are legal
 * pin targets but nearly useless ones, and they crowd out the handful of
 * names a reader is actually looking for.
 */
export function symbolCandidates(
  lines: string[],
  limit: number = MAX_SYMBOL_CANDIDATES
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (out.length >= limit) break;
    if (COMMENT_LINE.test(line) || NON_DECL_LINE.test(line)) continue;
    const text = stripLiterals(line);
    const name = DECL_CAPTURE.exec(text)?.[1];
    if (!name || name.length < 2 || !opensBlock(text)) continue;
    if (DECL_KEYWORD_SET.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
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
