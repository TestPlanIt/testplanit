import micromatch from "micromatch";

export interface PathPattern {
  path: string;
  pattern: string;
  /**
   * Subtract instead of include: files this row matches are left out even
   * when another row includes them, everywhere the connection filters the
   * repository (listing, cache, markers, and for Impact the changed files of
   * an analysis). Absent on rows saved before the flag existed = include.
   */
  exclude?: boolean;
}

/** The rows that include files; exclude rows never widen a scan. */
export function includeRows(pathPatterns: PathPattern[]): PathPattern[] {
  return pathPatterns.filter((row) => !row.exclude);
}

function composeGlob(basePath: string, pattern: string): string {
  const base = normalizeBasePath(basePath);
  return base ? `${base}/${pattern}` : pattern;
}

/**
 * The exclude rows as root-relative globs: trimmed, deduped, sorted. Takes
 * the stored JSON value as is, so the Impact worker and the reuse key read
 * the connection row directly.
 */
export function excludeGlobsOf(pathPatterns: unknown): string[] {
  if (!Array.isArray(pathPatterns)) return [];
  const globs = new Set<string>();
  for (const row of pathPatterns) {
    if (!row || typeof row !== "object" || !(row as PathPattern).exclude) {
      continue;
    }
    const { path, pattern } = row as PathPattern;
    const trimmed = typeof pattern === "string" ? pattern.trim() : "";
    if (!trimmed) continue;
    globs.add(composeGlob(typeof path === "string" ? path : "", trimmed));
  }
  return [...globs].sort();
}

/**
 * Normalize a base directory path so that ".", "./", and "" all mean the
 * repository root. Root is represented as the empty string "" — the form the
 * listing adapters expect (e.g. Bitbucket's `/src/<branch>/` returns a proper
 * JSON directory listing, whereas `/src/<branch>/.` resolves to a file body).
 */
export function normalizeBasePath(basePath: string): string {
  // Strip trailing slashes with a linear scan rather than a `/\/+$/` regex:
  // the end-anchored `+` backtracks O(n^2) on a long run of slashes, and
  // basePath is user-supplied (ReDoS — flagged by CodeQL).
  const start = (basePath ?? "").trim();
  let end = start.length;
  while (end > 0 && start.charCodeAt(end - 1) === 47 /* "/" */) end--;
  const trimmed = start.slice(0, end);
  if (trimmed === "" || trimmed === ".") return "";
  // Strip a leading "./" so "./src" behaves the same as "src".
  return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

/**
 * Extract unique base directory paths from PathPattern[] for scoped listing.
 *
 * Root ("") is included as an explicit seed whenever any pattern targets root,
 * so root-level files (e.g. CLAUDE.md) are actually scanned. Without this, a
 * naive "drop empty strings" guard would silently skip the repository root.
 */
export function extractBasePaths(pathPatterns: PathPattern[]): string[] {
  const includes = includeRows(pathPatterns);
  if (!includes.length) return [];
  const paths = new Set<string>();
  for (const { path: basePath } of includes) {
    paths.add(normalizeBasePath(basePath));
  }
  return [...paths];
}

// Deepest directory level we'll recurse for a recursive ("**") glob. Matches
// the provider listers' historical default and bounds runaway scans.
export const DEEP_SCAN_DEPTH = 10;

export interface BasePathScope {
  path: string; // normalized base ("" = repository root)
  maxDepth: number; // directory levels to scan below the base
}

/**
 * How many directory levels below the base a glob can match. A non-recursive
 * glob like "*.md" matches only files directly in the base (depth 1), so the
 * lister can scan shallow instead of crawling the whole subtree. Any
 * double-star segment means unbounded — use the deep cap.
 *
 * Examples: "*.md" is depth 1; "sub/*.ts" is depth 2; a recursive
 * double-star glob is DEEP_SCAN_DEPTH.
 */
export function globScanDepth(pattern: string): number {
  // Tolerate a leading "./" or "/" on the glob.
  const segments = pattern
    .replace(/^\.?\//, "")
    .split("/")
    .filter((s) => s.length > 0);
  if (segments.length === 0) return 1;
  if (segments.some((s) => s.includes("**"))) return DEEP_SCAN_DEPTH;
  return Math.min(segments.length, DEEP_SCAN_DEPTH);
}

/**
 * Like extractBasePaths, but also derives the shallowest scan depth that still
 * satisfies every glob targeting each base. Lets the lister avoid a full-repo
 * crawl when a root pattern only wants top-level files (e.g. "." + "*.md").
 */
export function extractBasePathScopes(
  pathPatterns: PathPattern[]
): BasePathScope[] {
  const includes = includeRows(pathPatterns);
  if (!includes.length) return [];
  const depthByBase = new Map<string, number>();
  for (const { path: basePath, pattern } of includes) {
    const base = normalizeBasePath(basePath);
    const depth = globScanDepth(pattern);
    depthByBase.set(base, Math.max(depthByBase.get(base) ?? 0, depth));
  }
  return [...depthByBase.entries()].map(([path, maxDepth]) => ({
    path,
    maxDepth,
  }));
}

/**
 * Filter a flat file list down to those matching the include rows (combined
 * base + glob, unioned), then drop whatever the exclude rows match. A root
 * pattern uses the glob as-is (e.g. "CLAUDE.md", with no "./" prefix) so
 * micromatch matches root-level paths. With no include rows every file is a
 * candidate. Exclude globs also match dotfiles, so `.github/**` works.
 */
export function applyPathPatterns<T extends { path: string }>(
  allFiles: T[],
  pathPatterns: PathPattern[]
): T[] {
  const includes = includeRows(pathPatterns);
  let kept = allFiles;
  if (includes.length) {
    const matched = new Set<string>();
    const filePaths = allFiles.map((f) => f.path);
    for (const { path: basePath, pattern } of includes) {
      const matchedPaths = micromatch(
        filePaths,
        composeGlob(basePath, pattern)
      );
      matchedPaths.forEach((p: string) => matched.add(p));
    }
    kept = allFiles.filter((f) => matched.has(f.path));
  }
  const excludes = excludeGlobsOf(pathPatterns);
  if (!excludes.length) return kept;
  const excluded = new Set<string>(
    micromatch(
      kept.map((f) => f.path),
      excludes,
      { dot: true }
    )
  );
  return kept.filter((f) => !excluded.has(f.path));
}
