import { createHash } from "crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";

export const ANNOTATION_MARKER_RE =
  /@testplanit\s+case:\s*(\d+(?:\s*,\s*\d+)*)/gi;
export const TESTMAP_PATHS = [
  ".testplanit/testmap.yml",
  ".testplanit/testmap.yaml",
] as const;
export const MAX_SCANNED_FILE_BYTES = 512 * 1024;
export const MAX_ANCHOR_SNIPPET_BYTES = 32 * 1024;
const MAX_BLOCK_LINES = 2000;
const MAX_CODE_LOOKAHEAD = 5;
const BATCH_SIZE = 200;
const MAX_REPORTED_PROBLEMS = 20;

const COMMENT_ONLY_RE =
  /^(\/\/|#|\*|\/\*|\*\/|<!--|-->|--|'''|"""|@testplanit\b)/i;

export type AnnotationKind = "RANGE" | "FILE";

export interface AnnotationMarker {
  caseIds: number[];
  kind: AnnotationKind;
  /** 1-based; for RANGE the marker line itself, for FILE the marker line. */
  startLine: number;
  endLine: number;
  markerLine: number;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isCommentOnly(line: string): boolean {
  return COMMENT_ONLY_RE.test(line.trim());
}

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

function extractCaseIds(line: string): number[] {
  const ids = new Set<number>();
  for (const match of line.matchAll(ANNOTATION_MARKER_RE)) {
    for (const part of match[1].split(",")) {
      const id = Number.parseInt(part.trim(), 10);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

/** 0-based index of the last line of the block a marker covers, or null when no code follows. */
function findBlockEnd(lines: string[], markerIdx: number): number | null {
  const searchFrom = isCommentOnly(lines[markerIdx])
    ? markerIdx + 1
    : markerIdx;
  let codeIdx = -1;
  for (
    let j = searchFrom;
    j < lines.length && j <= markerIdx + MAX_CODE_LOOKAHEAD;
    j++
  ) {
    if (isBlank(lines[j]) || isCommentOnly(lines[j])) continue;
    codeIdx = j;
    break;
  }
  if (codeIdx < 0) return null;

  const limit = Math.min(lines.length, codeIdx + MAX_BLOCK_LINES);
  const opensBrace = lines
    .slice(codeIdx, codeIdx + 3)
    .some((line) => line.includes("{"));

  if (opensBrace) {
    let depth = 0;
    let opened = false;
    for (let j = codeIdx; j < limit; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (opened && depth <= 0) return j;
    }
    return limit - 1;
  }

  const indent = indentOf(lines[codeIdx]);
  let end = codeIdx;
  for (let j = codeIdx + 1; j < limit; j++) {
    if (isBlank(lines[j])) continue;
    if (indentOf(lines[j]) <= indent) break;
    end = j;
  }
  return end;
}

/**
 * Find every `@testplanit case:<ids>` marker in a file and the code block
 * each one covers. Markers are plain text on a line, so any comment style
 * works. A marker with no code within the next 5 lines pins the whole file.
 */
export function parseAnnotations(
  path: string,
  content: string
): AnnotationMarker[] {
  const lines = content.split(/\r?\n/);
  const markers: AnnotationMarker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const caseIds = extractCaseIds(lines[i]);
    if (caseIds.length === 0) continue;
    const markerLine = i + 1;
    const end = findBlockEnd(lines, i);
    markers.push(
      end === null
        ? {
            caseIds,
            kind: "FILE",
            startLine: markerLine,
            endLine: markerLine,
            markerLine,
          }
        : {
            caseIds,
            kind: "RANGE",
            startLine: markerLine,
            endLine: end + 1,
            markerLine,
          }
    );
  }
  return markers;
}

export interface MapEntry {
  glob: string;
  cases: number[];
  tags: string[];
  note?: string;
}

export type MarkerScanProblemKind =
  | "unknown_case"
  | "foreign_case"
  | "unknown_tag"
  | "yaml_error"
  | "invalid_entry";

export interface MarkerScanProblem {
  kind: MarkerScanProblemKind;
  detail: string;
}

const mapEntrySchema = z
  .object({
    glob: z.string().min(1).max(1000),
    cases: z.array(z.number().int().positive()).optional(),
    tags: z.array(z.string().min(1).max(100)).optional(),
    note: z.string().max(2000).optional(),
  })
  .refine(
    (entry) => (entry.cases?.length ?? 0) > 0 || (entry.tags?.length ?? 0) > 0,
    { message: "An entry needs cases or tags" }
  );

const testMapSchema = z.object({
  pins: z.array(z.unknown()).default([]),
});

function describeIssues(
  issues: { path: PropertyKey[]; message: string }[]
): string {
  return issues
    .map((issue) => {
      const at = issue.path.map(String).join(".");
      return at ? `${at}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/** `parseTestMap` with each error classified for the scan report. */
export function parseTestMapProblems(yamlText: string): {
  entries: MapEntry[];
  problems: MarkerScanProblem[];
} {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { entries: [], problems: [{ kind: "yaml_error", detail: message }] };
  }

  const top = testMapSchema.safeParse(doc ?? {});
  if (!top.success) {
    return {
      entries: [],
      problems: [
        {
          kind: "yaml_error",
          detail: `testmap must be a mapping with a pins list (${describeIssues(top.error.issues)})`,
        },
      ],
    };
  }

  const entries: MapEntry[] = [];
  const problems: MarkerScanProblem[] = [];
  top.data.pins.forEach((raw, index) => {
    const parsed = mapEntrySchema.safeParse(raw);
    if (!parsed.success) {
      problems.push({
        kind: "invalid_entry",
        detail: `pins[${index}]: ${describeIssues(parsed.error.issues)}`,
      });
      return;
    }
    entries.push({
      glob: parsed.data.glob,
      cases: [...new Set(parsed.data.cases ?? [])],
      tags: [...new Set(parsed.data.tags ?? [])],
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
  });
  return { entries, problems };
}

/**
 * Parse `.testplanit/testmap.yml`. Unknown top-level keys are ignored; a YAML
 * syntax error yields a single error and invalid entries are skipped with one
 * error each.
 */
export function parseTestMap(yamlText: string): {
  entries: MapEntry[];
  errors: string[];
} {
  const { entries, problems } = parseTestMapProblems(yamlText);
  return { entries, errors: problems.map((p) => p.detail) };
}

function normalizeSnippet(snippet: string): string {
  return snippet
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

/** sha1 of the whitespace-normalized snippet; matches the manual-pin anchor hash. */
export function hashSnippet(snippet: string): string {
  return createHash("sha1").update(normalizeSnippet(snippet)).digest("hex");
}

function capSnippet(lines: string[]): string {
  const out: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const add = Buffer.byteLength(line, "utf8") + (out.length > 0 ? 1 : 0);
    if (bytes + add > MAX_ANCHOR_SNIPPET_BYTES) break;
    bytes += add;
    out.push(line);
  }
  return out.join("\n");
}

/** Files the scanner ignores: oversized, or with a NUL byte in the first 8 KB. */
export function isScannableFile(content: string): boolean {
  if (content.length > MAX_SCANNED_FILE_BYTES) return false;
  if (Buffer.byteLength(content, "utf8") > MAX_SCANNED_FILE_BYTES) return false;
  return !content.slice(0, 8192).includes("\0");
}

/** Only IMPACT configs with file caching on can be scanned. */
export function shouldScanMarkers(config: {
  purpose: string | null | undefined;
  cacheEnabled: boolean;
}): boolean {
  return config.purpose === "IMPACT" && config.cacheEnabled === true;
}

export type MarkerPinKind = "FILE" | "RANGE" | "GLOB";
export type MarkerPinSource = "ANNOTATION" | "MAPFILE";

export interface MarkerPinData {
  caseId: number;
  kind: MarkerPinKind;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  anchorSha: string | null;
  anchorSnippet: string | null;
  anchorHash: string | null;
  source: MarkerPinSource;
  note: string | null;
}

interface ExistingPinRow extends MarkerPinData {
  id: number;
}

export interface MarkerScanDb {
  tags: {
    findMany(
      args: unknown
    ): Promise<{ name: string; caseTags: { caseId: number }[] }[]>;
  };
  repositoryCases: {
    findMany(args: unknown): Promise<{ id: number }[]>;
  };
  repositoryCaseCodePin: {
    findMany(args: unknown): Promise<ExistingPinRow[]>;
    createMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface MarkerScanConfig {
  id: number;
  projectId: number;
  branch: string | null;
}

export interface MarkerScanOptions {
  /** Branch tip the scanned contents came from; anchors every annotation pin. */
  anchorSha: string;
  /** User recorded as creator of new pins. */
  actorId: string;
}

export interface MarkerScanReport {
  scannedFiles: number;
  skippedFiles: number;
  annotationMarkers: number;
  mapEntries: number;
  created: number;
  updated: number;
  removed: number;
  /** Pins whose block did not change; their anchor sha is still advanced to the tip. */
  unchanged: number;
  problems: MarkerScanProblem[];
  problemCount: number;
  anchorSha: string;
  scannedAt: string;
}

function pinKey(pin: {
  caseId: number;
  kind: string;
  filePath: string;
  startLine: number | null;
  symbol: string | null;
}): string {
  return `${pin.caseId}|${pin.kind}|${pin.filePath}|${pin.startLine ?? 0}|${pin.symbol ?? ""}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

type ComparedField = "endLine" | "anchorSnippet" | "anchorHash" | "note";
const COMPARED_FIELDS: ComparedField[] = [
  "endLine",
  "anchorSnippet",
  "anchorHash",
  "note",
];

/**
 * Bring the ANNOTATION and MAPFILE pins of a config in line with the markers
 * found in `files`. MANUAL and AI pins are never touched. Case ids that do
 * not belong to the project, and tags with no cases, are reported and
 * skipped rather than created.
 */
export async function syncMarkerPins(
  db: MarkerScanDb,
  config: MarkerScanConfig,
  files: Map<string, string>,
  opts: MarkerScanOptions
): Promise<MarkerScanReport> {
  const problems: MarkerScanProblem[] = [];
  const firstReference = new Map<number, string>();
  const noteReference = (caseId: number, where: string) => {
    if (!firstReference.has(caseId)) firstReference.set(caseId, where);
  };

  let scannedFiles = 0;
  let skippedFiles = 0;
  let annotationMarkers = 0;
  const scanned: {
    path: string;
    lines: string[];
    content: string;
    markers: AnnotationMarker[];
  }[] = [];
  for (const [path, content] of files) {
    if (!isScannableFile(content)) {
      skippedFiles++;
      continue;
    }
    scannedFiles++;
    const markers = parseAnnotations(path, content);
    if (markers.length === 0) continue;
    annotationMarkers += markers.length;
    scanned.push({ path, content, lines: content.split(/\r?\n/), markers });
    for (const marker of markers) {
      for (const caseId of marker.caseIds) {
        noteReference(caseId, `${path}:${marker.markerLine}`);
      }
    }
  }

  let entries: MapEntry[] = [];
  const mapPath = TESTMAP_PATHS.find((p) => files.has(p));
  if (mapPath !== undefined) {
    const parsed = parseTestMapProblems(files.get(mapPath) ?? "");
    entries = parsed.entries;
    problems.push(...parsed.problems);
    entries.forEach((entry, index) => {
      for (const caseId of entry.cases) {
        noteReference(caseId, `${mapPath} pins[${index}]`);
      }
    });
  }

  const tagCases = new Map<string, number[]>();
  const tagNames = [
    ...new Map(
      entries.flatMap((e) => e.tags).map((t) => [t.toLowerCase(), t])
    ).values(),
  ];
  if (tagNames.length > 0) {
    const rows = await db.tags.findMany({
      where: {
        name: { in: tagNames, mode: "insensitive" },
        isDeleted: false,
      },
      select: {
        name: true,
        caseTags: {
          where: { case: { projectId: config.projectId, isDeleted: false } },
          select: { caseId: true },
        },
      },
    });
    for (const row of rows) {
      tagCases.set(
        row.name.toLowerCase(),
        row.caseTags.map((ct) => ct.caseId)
      );
    }
    for (const name of tagNames) {
      const ids = tagCases.get(name.toLowerCase());
      if (!ids) {
        problems.push({
          kind: "unknown_tag",
          detail: `Tag "${name}" not found`,
        });
      } else if (ids.length === 0) {
        problems.push({
          kind: "unknown_tag",
          detail: `Tag "${name}" has no cases in this project`,
        });
      }
    }
  }

  const validIds = new Set<number>();
  const referenced = [...firstReference.keys()];
  if (referenced.length > 0) {
    const rows = await db.repositoryCases.findMany({
      where: {
        id: { in: referenced },
        projectId: config.projectId,
        isDeleted: false,
      },
      select: { id: true },
    });
    for (const row of rows) validIds.add(row.id);
    const missing = referenced.filter((id) => !validIds.has(id));
    if (missing.length > 0) {
      const elsewhere = await db.repositoryCases.findMany({
        where: { id: { in: missing }, isDeleted: false },
        select: { id: true },
      });
      const foreign = new Set(elsewhere.map((row) => row.id));
      for (const id of missing) {
        const at = firstReference.get(id);
        problems.push(
          foreign.has(id)
            ? {
                kind: "foreign_case",
                detail: `Case ${id} belongs to another project (${at})`,
              }
            : { kind: "unknown_case", detail: `Case ${id} not found (${at})` }
        );
      }
    }
  }

  const desired = new Map<string, MarkerPinData>();
  const want = (pin: MarkerPinData) => {
    const key = pinKey(pin);
    if (!desired.has(key)) desired.set(key, pin);
  };
  for (const file of scanned) {
    for (const marker of file.markers) {
      for (const caseId of marker.caseIds) {
        if (!validIds.has(caseId)) continue;
        if (marker.kind === "FILE") {
          want({
            caseId,
            kind: "FILE",
            filePath: file.path,
            startLine: null,
            endLine: null,
            symbol: null,
            anchorSha: opts.anchorSha,
            anchorSnippet: null,
            anchorHash: hashSnippet(file.content),
            source: "ANNOTATION",
            note: null,
          });
          continue;
        }
        const snippet = capSnippet(
          file.lines.slice(marker.startLine - 1, marker.endLine)
        );
        want({
          caseId,
          kind: "RANGE",
          filePath: file.path,
          startLine: marker.startLine,
          endLine: marker.endLine,
          symbol: null,
          anchorSha: opts.anchorSha,
          anchorSnippet: snippet,
          anchorHash: hashSnippet(snippet),
          source: "ANNOTATION",
          note: null,
        });
      }
    }
  }
  for (const entry of entries) {
    const caseIds = new Set<number>(
      entry.cases.filter((id) => validIds.has(id))
    );
    for (const tag of entry.tags) {
      for (const id of tagCases.get(tag.toLowerCase()) ?? []) caseIds.add(id);
    }
    for (const caseId of caseIds) {
      want({
        caseId,
        kind: "GLOB",
        filePath: entry.glob,
        startLine: null,
        endLine: null,
        symbol: null,
        anchorSha: null,
        anchorSnippet: null,
        anchorHash: null,
        source: "MAPFILE",
        note: entry.note ?? null,
      });
    }
  }

  const existing = await db.repositoryCaseCodePin.findMany({
    where: {
      configId: config.id,
      source: { in: ["ANNOTATION", "MAPFILE"] },
      isDeleted: false,
    },
    select: {
      id: true,
      caseId: true,
      kind: true,
      filePath: true,
      startLine: true,
      endLine: true,
      symbol: true,
      anchorSha: true,
      anchorSnippet: true,
      anchorHash: true,
      source: true,
      note: true,
    },
  });
  const byKey = new Map<string, ExistingPinRow>();
  const toRemove: number[] = [];
  for (const row of existing) {
    const key = pinKey(row);
    if (byKey.has(key)) toRemove.push(row.id);
    else byKey.set(key, row);
  }

  const toCreate: MarkerPinData[] = [];
  const reanchor: number[] = [];
  let updated = 0;
  let unchanged = 0;
  for (const [key, pin] of desired) {
    const row = byKey.get(key);
    if (!row) {
      toCreate.push(pin);
      continue;
    }
    byKey.delete(key);
    const changed = COMPARED_FIELDS.some((field) => row[field] !== pin[field]);
    if (changed) {
      await db.repositoryCaseCodePin.update({
        where: { id: row.id },
        data: {
          endLine: pin.endLine,
          anchorSha: pin.anchorSha,
          anchorSnippet: pin.anchorSnippet,
          anchorHash: pin.anchorHash,
          note: pin.note,
        },
      });
      updated++;
      continue;
    }
    if (row.anchorSha !== pin.anchorSha) reanchor.push(row.id);
    unchanged++;
  }
  for (const row of byKey.values()) toRemove.push(row.id);

  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    await db.repositoryCaseCodePin.createMany({
      data: batch.map((pin) => ({
        ...pin,
        configId: config.id,
        createdById: opts.actorId,
      })),
    });
  }
  for (const batch of chunk(reanchor, BATCH_SIZE)) {
    await db.repositoryCaseCodePin.updateMany({
      where: { id: { in: batch } },
      data: { anchorSha: opts.anchorSha },
    });
  }
  const deletedAt = new Date();
  for (const batch of chunk(toRemove, BATCH_SIZE)) {
    await db.repositoryCaseCodePin.updateMany({
      where: { id: { in: batch } },
      data: { isDeleted: true, deletedAt },
    });
  }

  return {
    scannedFiles,
    skippedFiles,
    annotationMarkers,
    mapEntries: entries.length,
    created: toCreate.length,
    updated,
    removed: toRemove.length,
    unchanged,
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
    problemCount: problems.length,
    anchorSha: opts.anchorSha,
    scannedAt: new Date().toISOString(),
  };
}
