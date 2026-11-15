import picomatch from "picomatch/posix";

/**
 * How many of `paths` the glob `pattern` matches, for browser code.
 *
 * `picomatch` is the matcher `micromatch` is built on and needs no Node
 * built-ins. `dot: true` is what the server uses when it evaluates a GLOB
 * code pin, so a count shown before saving agrees with what the pin will
 * match afterwards.
 */
export function countGlobMatches(paths: string[], pattern: string): number {
  const matches = picomatch(pattern, { dot: true });
  let count = 0;
  for (const path of paths) {
    if (matches(path)) count += 1;
  }
  return count;
}
