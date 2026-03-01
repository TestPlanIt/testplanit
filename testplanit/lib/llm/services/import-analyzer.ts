/**
 * import-analyzer.ts
 *
 * Pure, side-effect-free module providing BFS import graph analysis functions.
 * Used by CodeContextService to rank repository files by proximity to the
 * test case being generated.
 *
 * No imports from the TestPlanIt app — only node:path/posix.
 */

import { posix } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum ratio of re-export lines to consider a file a barrel file. */
export const BARREL_THRESHOLD = 0.7;

/** BFS distance penalty added to barrel files' effective distance. */
export const BARREL_PENALTY = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Language = "ts" | "js" | "python" | "java" | "unknown";

export interface RankedFile {
  path: string;
  effectiveDistance: number;
}

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

/**
 * Detect the language of a file from its path extension.
 */
export function detectLanguage(filePath: string): Language {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "ts";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "js";
    case ".py":
      return "python";
    case ".java":
      return "java";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// extractImportSpecifiers
// ---------------------------------------------------------------------------

/**
 * Extract all import specifiers (module paths) from file content.
 * Returns raw specifier strings — does not filter externals vs relative.
 *
 * Each call creates fresh RegExp instances to avoid lastIndex issues with /g.
 */
export function extractImportSpecifiers(content: string, language: Language): string[] {
  const specifiers: string[] = [];

  if (language === "ts" || language === "js") {
    // Patterns to match (each is a fresh RegExp to avoid shared lastIndex):
    //   import ... from "specifier"
    //   import "specifier"  (side-effect)
    //   export ... from "specifier"
    //   const x = require("specifier")
    const patterns = [
      // import ... from '...' or import '...'
      /import\s+(?:type\s+)?(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/g,
      // export { ... } from '...'  /  export * from '...'
      /export\s+(?:type\s+)?(?:[\w*{},\s]+|\*)\s+from\s+['"]([^'"]+)['"]/g,
      // require('...')
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        specifiers.push(match[1]);
      }
    }
  } else if (language === "python") {
    // from x import y  →  specifier = x
    const fromImport = /^from\s+([\w.]+)\s+import/gm;
    // import x  →  specifier = x
    const directImport = /^import\s+([\w.]+)/gm;

    let match: RegExpExecArray | null;
    while ((match = fromImport.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
    while ((match = directImport.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  } else if (language === "java") {
    // import com.example.Foo;
    const javaImport = /^import\s+([\w.]+);/gm;
    let match: RegExpExecArray | null;
    while ((match = javaImport.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }
  // "unknown" → return []

  return specifiers;
}

// ---------------------------------------------------------------------------
// resolveSpecifier
// ---------------------------------------------------------------------------

/**
 * Resolve an import specifier to a repo-relative file path.
 *
 * Returns null if:
 *  - specifier is not relative (does not start with "./" or "../")
 *  - no match found in availablePaths
 */
export function resolveSpecifier(
  specifier: string,
  importerPath: string,
  availablePaths: Set<string>
): string | null {
  // Only resolve relative imports
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }

  // importerDir = directory of the importing file
  const importerDir = posix.dirname(importerPath);
  // Normalize the combined path (handles ".." segments)
  const normalized = posix.normalize(posix.join(importerDir, specifier));

  // Try exact match first
  if (availablePaths.has(normalized)) {
    return normalized;
  }

  // Try extension elision
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
  for (const ext of extensions) {
    const candidate = normalized + ext;
    if (availablePaths.has(candidate)) {
      return candidate;
    }
  }

  // Try index resolution
  const indexFiles = [
    "/index.ts",
    "/index.tsx",
    "/index.js",
    "/index.jsx",
  ];
  for (const idx of indexFiles) {
    const candidate = normalized + idx;
    if (availablePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// isBarrelFile
// ---------------------------------------------------------------------------

/**
 * Determine whether file content is a barrel file (primarily re-exports).
 *
 * A file is considered a barrel if at least BARREL_THRESHOLD (70%) of its
 * non-blank lines match re-export patterns (`export {` or `export *`).
 */
export function isBarrelFile(content: string): boolean {
  const nonBlankLines = content.split("\n").filter((l) => l.trim().length > 0);
  if (nonBlankLines.length === 0) return false;

  const reExportLines = nonBlankLines.filter((l) => {
    const trimmed = l.trim();
    return /^export\s+\{/.test(trimmed) || /^export\s+\*/.test(trimmed);
  });

  return reExportLines.length / nonBlankLines.length >= BARREL_THRESHOLD;
}

// ---------------------------------------------------------------------------
// buildImportGraph
// ---------------------------------------------------------------------------

/**
 * Build an adjacency graph from file contents.
 *
 * For each file in fileContents, detect its language, extract import specifiers,
 * and resolve each to a repo-relative path. Only resolved paths that exist in
 * availablePaths are added as edges.
 *
 * Paths that appear in availablePaths but not in fileContents get an empty Set
 * (no outgoing edges known from their content).
 */
export function buildImportGraph(
  fileContents: Map<string, string>,
  availablePaths: Set<string>
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  // Initialize all available paths with empty sets
  for (const path of availablePaths) {
    adjacency.set(path, new Set());
  }

  // Build edges from file contents
  for (const [filePath, content] of fileContents) {
    const language = detectLanguage(filePath);
    const specifiers = extractImportSpecifiers(content, language);

    const edges = adjacency.get(filePath) ?? new Set<string>();

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(specifier, filePath, availablePaths);
      if (resolved !== null) {
        edges.add(resolved);
      }
    }

    adjacency.set(filePath, edges);
  }

  return adjacency;
}

// ---------------------------------------------------------------------------
// bfsRank
// ---------------------------------------------------------------------------

/**
 * BFS-rank all files by their import proximity to a seed file.
 *
 * - Uses a visited Set to guard against circular imports (no infinite loops).
 * - Barrel files get effectiveDistance = BFS_distance + BARREL_PENALTY.
 * - Unreachable files are appended at the end with effectiveDistance = Infinity.
 * - Returns sorted array: reachable (ascending effectiveDistance) + unreachable.
 */
export function bfsRank(
  seedPath: string,
  graph: Map<string, Set<string>>,
  allPaths: string[],
  barrelPaths: Set<string>
): RankedFile[] {
  const distances = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ path: string; distance: number }> = [];

  // Start BFS from seed
  distances.set(seedPath, 0);
  visited.add(seedPath);
  queue.push({ path: seedPath, distance: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.get(current.path) ?? new Set<string>();

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        const dist = current.distance + 1;
        distances.set(neighbor, dist);
        queue.push({ path: neighbor, distance: dist });
      }
    }
  }

  // Build result arrays
  const reachable: RankedFile[] = [];
  const unreachable: RankedFile[] = [];

  for (const path of allPaths) {
    if (distances.has(path)) {
      const dist = distances.get(path)!;
      const penalty = barrelPaths.has(path) ? BARREL_PENALTY : 0;
      reachable.push({ path, effectiveDistance: dist + penalty });
    } else {
      unreachable.push({ path, effectiveDistance: Infinity });
    }
  }

  // Sort reachable by effectiveDistance ascending
  reachable.sort((a, b) => a.effectiveDistance - b.effectiveDistance);

  return [...reachable, ...unreachable];
}
