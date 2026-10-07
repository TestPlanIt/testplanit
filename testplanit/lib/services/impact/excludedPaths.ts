import { createHash } from "node:crypto";
import micromatch from "micromatch";

export interface ChangedPathLike {
  path: string;
  previousPath?: string | null;
}

/** True for a changed file the connection's excluded paths tell an analysis to ignore. */
export type ExcludedPathMatcher = (file: ChangedPathLike) => boolean;

/**
 * Match changed files against the connection's exclude rows (as globs, see
 * `excludeGlobsOf`). Globs match the whole path from the repository root
 * (`**\/CHANGELOG*` for any depth), dotfiles included. A renamed file is excluded when either its new or its old path
 * matches, so a file moved out of an ignored place still counts as ignored
 * for this change.
 */
export function createExcludedPathMatcher(
  globs: string[]
): ExcludedPathMatcher {
  if (globs.length === 0) return () => false;
  const matches = (path: string) =>
    micromatch([path], globs, { dot: true }).length > 0;
  return (file) =>
    matches(file.path) || (!!file.previousPath && matches(file.previousPath));
}

/**
 * The part of an analysis's reuse key that comes from the connection's
 * settings: null while nothing is excluded (so older rows, which recorded
 * nothing, still match), otherwise a short order-independent digest.
 */
export function excludedPathsHash(globs: string[]): string | null {
  if (globs.length === 0) return null;
  return createHash("sha256")
    .update(JSON.stringify([...globs].sort()))
    .digest("hex")
    .slice(0, 16);
}
