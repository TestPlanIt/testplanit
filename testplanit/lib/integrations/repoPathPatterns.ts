import micromatch from "micromatch";

export interface PathPattern {
  path: string;
  pattern: string;
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
  if (!pathPatterns.length) return [];
  const paths = new Set<string>();
  for (const { path: basePath } of pathPatterns) {
    paths.add(normalizeBasePath(basePath));
  }
  return [...paths];
}

/**
 * Filter a flat file list down to those matching the combined base + glob
 * patterns. A root pattern uses the glob as-is (e.g. "CLAUDE.md", with no "./"
 * prefix) so micromatch matches root-level paths.
 */
export function applyPathPatterns<T extends { path: string }>(
  allFiles: T[],
  pathPatterns: PathPattern[]
): T[] {
  if (!pathPatterns.length) return allFiles;

  const matched = new Set<string>();
  const filePaths = allFiles.map((f) => f.path);
  for (const { path: basePath, pattern } of pathPatterns) {
    const base = normalizeBasePath(basePath);
    const globPattern = base ? `${base}/${pattern}` : pattern;
    const matchedPaths = micromatch(filePaths, globPattern);
    matchedPaths.forEach((p: string) => matched.add(p));
  }

  return allFiles.filter((f) => matched.has(f.path));
}
