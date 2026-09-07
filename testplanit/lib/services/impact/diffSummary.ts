/**
 * Turns a provider CompareResult into the budgeted DiffSummary the Impact
 * layers and the AI prompt consume, and renders it as compact prompt text.
 */

import type {
  ChangedFile,
  ChangedFileStatus,
  CompareResult,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { parseUnifiedDiff } from "~/lib/integrations/diff/parseUnifiedDiff";
import { estimatePromptTokens } from "~/lib/llm/content";
import type { ImpactConfig } from "./config";
import type {
  DiffDetailLevel,
  DiffFileClass,
  DiffFileSummary,
  DiffHunkSummary,
  DiffSummary,
} from "./types";

const LOCKFILE_RE =
  /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const MINIFIED_RE = /\.min\.(js|css)$/;
const VENDORED_RE = /(^|\/)(vendor|node_modules|third_party|\.yarn)\//;
const GENERATED_RE =
  /(__generated__|\.generated\.|\.pb\.go$|\.g\.dart$|\.snap$|(^|\/)(dist|build|out)\/)/;
const TEST_RE =
  /(\.(test|spec)\.[jt]sx?$|__tests__\/|(^|\/)tests?\/|_test\.go$|_spec\.rb$)/;
const DOCS_RE = /\.(md|mdx|rst|txt)$/;
const CONFIG_RE = /\.(json|ya?ml|toml|ini|env.*)$|(^|\/)\./;

const EXCLUDED_CLASSES: ReadonlySet<DiffFileClass> = new Set<DiffFileClass>([
  "binary",
  "lockfile",
  "minified",
  "vendored",
  "generated",
]);

const CLASS_ORDER: Record<DiffFileClass, number> = {
  source: 0,
  config: 1,
  test: 2,
  docs: 3,
  generated: 4,
  lockfile: 4,
  vendored: 4,
  minified: 4,
  binary: 4,
};

const EXCLUDED_RENDER_ORDER: DiffFileClass[] = [
  "lockfile",
  "generated",
  "vendored",
  "minified",
  "binary",
];

const STATUS_LETTER: Record<ChangedFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;
const DECL_RE =
  /\b(?:function|class|def|func|fn|interface|type|struct|enum|export (?:const|function|class)|public|private|protected)\s+([A-Za-z_$][\w$]*)/g;
const CONTEXT_VAR_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const SYMBOL_NOISE = new Set([
  "abstract",
  "as",
  "async",
  "class",
  "const",
  "default",
  "export",
  "extends",
  "final",
  "function",
  "if",
  "implements",
  "in",
  "is",
  "let",
  "new",
  "of",
  "override",
  "readonly",
  "return",
  "static",
  "var",
  "void",
]);

export const MAX_SYMBOLS_PER_HUNK = 8;
export const MAX_SYMBOLS_PER_FILE = 24;
const INDENT = "  ";

/** Classify a changed path; binary always wins. */
export function classifyPath(path: string, isBinary: boolean): DiffFileClass {
  if (isBinary) return "binary";
  const p = typeof path === "string" ? path : "";
  if (LOCKFILE_RE.test(p)) return "lockfile";
  if (MINIFIED_RE.test(p)) return "minified";
  if (VENDORED_RE.test(p)) return "vendored";
  if (GENERATED_RE.test(p)) return "generated";
  if (TEST_RE.test(p)) return "test";
  if (DOCS_RE.test(p)) return "docs";
  if (CONFIG_RE.test(p)) return "config";
  return "source";
}

interface HunkBlock {
  context: string;
  body: string;
  lines: string[];
}

function splitHunks(patch: string): HunkBlock[] {
  if (typeof patch !== "string" || patch.length === 0) return [];
  const blocks: HunkBlock[] = [];
  let current: HunkBlock | null = null;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER_RE.exec(line);
    if (header) {
      current = { context: header[1].trim(), body: "", lines: [line] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const block of blocks) {
    while (
      block.lines.length > 1 &&
      block.lines[block.lines.length - 1] === ""
    ) {
      block.lines.pop();
    }
    block.body = block.lines.join("\n");
  }
  return blocks;
}

function isSymbolName(name: string): boolean {
  return name.length >= 2 && !SYMBOL_NOISE.has(name);
}

function collectDeclarations(text: string, into: (name: string) => boolean) {
  DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECL_RE.exec(text)) !== null) {
    const name = match[1];
    if (!isSymbolName(name)) continue;
    if (!into(name)) return;
  }
}

function symbolsInHunk(block: HunkBlock): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): boolean => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    return out.length < MAX_SYMBOLS_PER_HUNK;
  };
  if (block.context) {
    let found = false;
    collectDeclarations(block.context, (name) => {
      found = true;
      return add(name);
    });
    if (!found) {
      const variable = CONTEXT_VAR_RE.exec(block.context);
      if (variable && isSymbolName(variable[1])) add(variable[1]);
    }
  }
  for (
    let i = 1;
    i < block.lines.length && out.length < MAX_SYMBOLS_PER_HUNK;
    i++
  ) {
    const line = block.lines[i];
    if (line[0] !== "+" && line[0] !== "-") continue;
    collectDeclarations(line.slice(1), add);
  }
  return out;
}

/** Declared names touched by a patch: hunk-header context plus +/- lines. */
export function extractChangedSymbols(patch: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of splitHunks(patch)) {
    for (const symbol of symbolsInHunk(block)) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      out.push(symbol);
      if (out.length >= MAX_SYMBOLS_PER_FILE) return out;
    }
  }
  return out;
}

interface PreparedFile {
  base: Omit<DiffFileSummary, "detail" | "patchExcerpt">;
  hunkBodies: string[];
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function prepareFile(file: ChangedFile, cls: DiffFileClass): PreparedFile {
  const hunks: DiffHunkSummary[] = [];
  const hunkBodies: string[] = [];
  for (const block of splitHunks(file.patch ?? "")) {
    const parsed = parseUnifiedDiff(block.body).hunks[0];
    if (!parsed) continue;
    const range = `@@ -${parsed.oldStart},${parsed.oldLines} +${parsed.newStart},${parsed.newLines} @@`;
    const symbols = symbolsInHunk(block);
    hunks.push({
      header: block.context ? `${range} ${block.context}` : range,
      oldStart: parsed.oldStart,
      oldLines: parsed.oldLines,
      newStart: parsed.newStart,
      newLines: parsed.newLines,
      ...(symbols.length > 0 ? { changedSymbols: symbols } : {}),
    });
    hunkBodies.push(block.body);
  }
  const base: PreparedFile["base"] = {
    path: String(file.path ?? ""),
    status: file.status,
    additions: toNumber(file.additions),
    deletions: toNumber(file.deletions),
    class: cls,
    hunks,
  };
  if (file.previousPath) base.previousPath = file.previousPath;
  return { base, hunkBodies };
}

function patchExcerptOf(hunkBodies: string[], maxChars: number): string {
  let out = "";
  for (const body of hunkBodies) {
    const next = out ? `${out}\n${body}` : body;
    if (next.length > maxChars) break;
    out = next;
  }
  if (!out && hunkBodies.length > 0) out = hunkBodies[0].slice(0, maxChars);
  return out;
}

function withDetail(
  prepared: PreparedFile,
  level: DiffDetailLevel,
  cfg: ImpactConfig
): DiffFileSummary {
  const effective: DiffDetailLevel =
    prepared.base.hunks.length === 0 ? "path" : level;
  const summary: DiffFileSummary = { ...prepared.base, detail: effective };
  if (effective === "patch") {
    summary.patchExcerpt = patchExcerptOf(
      prepared.hunkBodies,
      cfg.truncatePatchChars
    );
  }
  return summary;
}

function compareFiles(a: PreparedFile, b: PreparedFile): number {
  const classDelta = CLASS_ORDER[a.base.class] - CLASS_ORDER[b.base.class];
  if (classDelta !== 0) return classDelta;
  const churnA = a.base.additions + a.base.deletions;
  const churnB = b.base.additions + b.base.deletions;
  return churnB - churnA;
}

/** Build the budgeted summary; detail degrades patch → hunks → path → omitted. */
export function buildDiffSummary(
  compare: CompareResult,
  cfg: ImpactConfig,
  opts: { maxTokensPerRequest?: number } = {}
): DiffSummary {
  const rawFiles = Array.isArray(compare.files) ? compare.files : [];
  let truncatedByBudget = false;
  let omittedFileCount = 0;
  let capped = rawFiles;
  if (rawFiles.length > cfg.maxDiffFiles) {
    capped = rawFiles.slice(0, cfg.maxDiffFiles);
    truncatedByBudget = true;
    omittedFileCount = rawFiles.length - cfg.maxDiffFiles;
  }

  const excludedFiles: DiffSummary["excludedFiles"] = [];
  const included: PreparedFile[] = [];
  for (const file of capped) {
    const cls = classifyPath(file.path, Boolean(file.isBinary));
    if (EXCLUDED_CLASSES.has(cls)) {
      excludedFiles.push({ path: file.path, class: cls });
    } else {
      included.push(prepareFile(file, cls));
    }
  }
  included.sort(compareFiles);

  const requestCap =
    typeof opts.maxTokensPerRequest === "number" && opts.maxTokensPerRequest > 0
      ? Math.floor(opts.maxTokensPerRequest * 0.35)
      : Infinity;
  const budget = Math.min(cfg.diffTokenBudget, requestCap) * 0.75;

  const base = {
    baseSha: compare.baseSha,
    headSha: compare.headSha,
    excludedFiles,
    totalFiles: Math.max(rawFiles.length, toNumber(compare.totalFiles)),
    truncatedByProvider: Boolean(compare.truncated),
    truncatedByBudget,
    omittedFileCount,
    estimatedTokens: 0,
  };
  const tokensOf = (files: DiffFileSummary[]) =>
    estimatePromptTokens([
      { role: "user", content: renderDiffSummaryForPrompt({ ...base, files }) },
    ]);

  const files: DiffFileSummary[] = [];
  let index = 0;
  const fill = (level: DiffDetailLevel, limit: number) => {
    while (index < included.length && index < limit) {
      const candidate = withDetail(included[index], level, cfg);
      if (tokensOf([...files, candidate]) > budget) return;
      files.push(candidate);
      index++;
    }
  };
  fill("patch", Math.min(cfg.maxPatchFiles, included.length));
  fill("hunks", included.length);
  fill("path", included.length);

  if (index < included.length) {
    truncatedByBudget = true;
    omittedFileCount += included.length - index;
  }

  const summary: DiffSummary = {
    ...base,
    files,
    truncatedByBudget,
    omittedFileCount,
  };
  summary.estimatedTokens = tokensOf(files);
  return summary;
}

function fileLine(index: number, file: DiffFileSummary): string {
  const status = STATUS_LETTER[file.status] ?? "?";
  const path = String(file.path ?? "");
  const where =
    file.status === "renamed" && file.previousPath
      ? `${file.previousPath} → ${path}`
      : path;
  const parts = [
    `${index}. ${status} ${where} (+${toNumber(file.additions)}/-${toNumber(file.deletions)})`,
  ];
  if (file.detail === "hunks") parts.push("[hunks only]");
  if (file.detail === "path") parts.push("[path only]");
  const symbols = fileSymbols(file);
  if (symbols.length > 0) parts.push(`symbols: ${symbols.join(", ")}`);
  return parts.join(" ");
}

function fileSymbols(file: DiffFileSummary): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const hunks = Array.isArray(file.hunks) ? file.hunks : [];
  for (const hunk of hunks) {
    for (const symbol of hunk?.changedSymbols ?? []) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      out.push(symbol);
      if (out.length >= MAX_SYMBOLS_PER_FILE) return out;
    }
  }
  return out;
}

function countHunkHeaders(excerpt: string): number {
  let count = 0;
  for (const line of excerpt.split("\n")) {
    if (HUNK_HEADER_RE.test(line)) count++;
  }
  return count;
}

function excludedLine(excluded: DiffSummary["excludedFiles"]): string | null {
  if (!Array.isArray(excluded) || excluded.length === 0) return null;
  const counts = new Map<DiffFileClass, number>();
  for (const entry of excluded) {
    const cls = entry?.class;
    if (!cls) continue;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const cls of EXCLUDED_RENDER_ORDER) {
    const n = counts.get(cls);
    if (!n) continue;
    const label =
      cls === "lockfile" ? (n === 1 ? "lockfile" : "lockfiles") : cls;
    parts.push(`${n} ${label}`);
  }
  for (const [cls, n] of counts) {
    if (!EXCLUDED_RENDER_ORDER.includes(cls)) parts.push(`${n} ${cls}`);
  }
  return parts.length > 0 ? `Excluded: ${parts.join(", ")}` : null;
}

/** Compact numbered rendering of a DiffSummary for the AI prompt. */
export function renderDiffSummaryForPrompt(summary: DiffSummary): string {
  const lines: string[] = [];
  const files = Array.isArray(summary?.files) ? summary.files : [];
  files.forEach((file, i) => {
    if (!file) return;
    lines.push(fileLine(i + 1, file));
    const hunks = Array.isArray(file.hunks) ? file.hunks : [];
    if (file.detail === "patch" && typeof file.patchExcerpt === "string") {
      for (const line of file.patchExcerpt.split("\n")) {
        lines.push(INDENT + line);
      }
      const shown = countHunkHeaders(file.patchExcerpt);
      for (const hunk of hunks.slice(shown)) {
        if (hunk?.header) lines.push(INDENT + hunk.header);
      }
    } else if (file.detail === "hunks") {
      for (const hunk of hunks) {
        if (hunk?.header) lines.push(INDENT + hunk.header);
      }
    }
  });
  const excluded = excludedLine(summary?.excludedFiles);
  if (excluded) lines.push(excluded);
  const omitted = toNumber(summary?.omittedFileCount);
  if (omitted > 0) lines.push(`(${omitted} more changed files omitted)`);
  return lines.join("\n");
}
