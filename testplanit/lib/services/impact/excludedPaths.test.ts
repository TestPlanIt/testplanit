import { describe, expect, it } from "vitest";
import { createExcludedPathMatcher, excludedPathsHash } from "./excludedPaths";

describe("createExcludedPathMatcher", () => {
  const isExcluded = createExcludedPathMatcher([
    "app/build.gradle.kts",
    "**/CHANGELOG*",
    "docs/**",
    ".github/**",
  ]);

  it("matches a whole path from the repository root", () => {
    expect(isExcluded({ path: "app/build.gradle.kts" })).toBe(true);
    expect(isExcluded({ path: "lib/app/build.gradle.kts" })).toBe(false);
    expect(isExcluded({ path: "app/build.gradle.kts.bak" })).toBe(false);
  });

  it("matches **/ globs at any depth, including the root", () => {
    expect(isExcluded({ path: "CHANGELOG.md" })).toBe(true);
    expect(isExcluded({ path: "packages/cli/CHANGELOG.md" })).toBe(true);
    expect(isExcluded({ path: "docs/guide/intro.md" })).toBe(true);
    expect(isExcluded({ path: "src/docs.ts" })).toBe(false);
  });

  it("matches dotfiles and dot directories", () => {
    expect(isExcluded({ path: ".github/workflows/ci.yml" })).toBe(true);
    expect(createExcludedPathMatcher(["**/*.yml"])({ path: ".ci/a.yml" })).toBe(
      true
    );
  });

  it("excludes a rename when either side matches", () => {
    expect(
      isExcluded({ path: "src/notes.md", previousPath: "CHANGELOG.md" })
    ).toBe(true);
    expect(
      isExcluded({ path: "CHANGELOG.md", previousPath: "src/notes.md" })
    ).toBe(true);
    expect(isExcluded({ path: "src/a.ts", previousPath: "src/b.ts" })).toBe(
      false
    );
    expect(isExcluded({ path: "src/a.ts", previousPath: null })).toBe(false);
  });

  it("matches nothing when no globs are set", () => {
    expect(createExcludedPathMatcher([])({ path: "CHANGELOG.md" })).toBe(false);
  });
});

describe("excludedPathsHash", () => {
  it("is null for no globs and stable regardless of order", () => {
    expect(excludedPathsHash([])).toBeNull();
    const a = excludedPathsHash(["a/**", "b.txt"]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(excludedPathsHash(["b.txt", "a/**"])).toBe(a);
    expect(excludedPathsHash(["a/**"])).not.toBe(a);
  });
});
