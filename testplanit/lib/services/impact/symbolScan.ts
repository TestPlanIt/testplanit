/**
 * Finding declarations in source text: where a symbol is declared, how far
 * its block runs, and which names in a file are worth pinning. Text in, line
 * numbers out, with no imports, so browser code can use it too.
 */

const BRACE_SCAN_CAP = 2000;
const SIGNATURE_SCAN_CAP = 60;

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

export function wholeWordPattern(symbol: string): RegExp {
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
