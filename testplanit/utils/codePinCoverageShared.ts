/**
 * Client-safe pieces of the Code Pin Coverage report: the row shape and the
 * directory rule. The handler in codePinCoverageReportUtils.ts re-exports
 * them; browser code must import from here so no database client is pulled
 * into the client bundle.
 */
export const PIN_KINDS = ["FILE", "RANGE", "SYMBOL", "GLOB"] as const;
export const PIN_SOURCES = [
  "MANUAL",
  "AI",
  "ANNOTATION",
  "MAPFILE",
  "ISSUE",
] as const;
export type PinKind = (typeof PIN_KINDS)[number];
export type PinSource = (typeof PIN_SOURCES)[number];
export type CoverageFilter = "all" | "gaps" | "pinned";

export const ROOT_DIRECTORY = "/";

export interface CodePinCoverageRow {
  repository: {
    configId: number;
    repositoryId: number;
    name: string;
    provider: string;
    branch: string | null;
  };
  directory: string;
  pinCount: number;
  kindCounts: Record<PinKind, number>;
  sourceCounts: Record<PinSource, number>;
  /** Distinct cases with a pin in this directory. */
  caseCount: number;
  /** Pins the latest analysis of the connection reported as stale. */
  stalePinCount: number;
  /** Distinct changed files in the window no pin covered. */
  uncoveredFileCount: number;
  /** Analyses in the window that left a file here uncovered. */
  uncoveredAnalysisCount: number;
  sampleUncoveredFiles: string[];
  /** Project-wide figures repeated on every row so the tiles can read them. */
  projectCaseTotal: number;
  projectCasesWithPins: number;
  project?: { id: number; name?: string };
}

/**
 * The two-level directory of a path: "src/payments/charge.ts" is
 * "src/payments". A glob stops at its first star; a root file is "/".
 */
export function directoryOf(filePath: string, depth = 2): string {
  const cleaned = filePath.replace(/^\/+/, "");
  const star = cleaned.indexOf("*");
  const literal = star === -1 ? cleaned : cleaned.slice(0, star);
  const parts = literal.split("/").filter(Boolean);
  // The last segment of a plain path is the file itself.
  const dirs = star === -1 ? parts.slice(0, -1) : parts;
  if (dirs.length === 0) return ROOT_DIRECTORY;
  return dirs.slice(0, depth).join("/");
}
