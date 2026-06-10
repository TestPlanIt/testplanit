import { describe, expect, it } from "vitest";
import {
  applyPathPatterns,
  extractBasePaths,
  normalizeBasePath,
  type PathPattern,
} from "./repoPathPatterns";

function file(path: string, size = 0) {
  return { path, size, type: "file" as const };
}

describe("normalizeBasePath", () => {
  it("treats '.', './', and '' all as repository root ('')", () => {
    expect(normalizeBasePath(".")).toBe("");
    expect(normalizeBasePath("./")).toBe("");
    expect(normalizeBasePath("")).toBe("");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBasePath("src/")).toBe("src");
    expect(normalizeBasePath("src/utils//")).toBe("src/utils");
  });

  it("strips a leading './' prefix", () => {
    expect(normalizeBasePath("./src")).toBe("src");
  });

  it("leaves a normal path untouched", () => {
    expect(normalizeBasePath("src/utils")).toBe("src/utils");
  });
});

describe("extractBasePaths", () => {
  it("returns [] when there are no patterns", () => {
    expect(extractBasePaths([])).toEqual([]);
  });

  it("maps '.', './', and '' to root ('') so root is explicitly seeded", () => {
    for (const path of [".", "./", ""]) {
      const result = extractBasePaths([{ path, pattern: "CLAUDE.md" }]);
      expect(result).toEqual([""]);
    }
  });

  it("keeps non-root base paths and dedupes them", () => {
    const patterns: PathPattern[] = [
      { path: "src/", pattern: "**/*.ts" },
      { path: "src", pattern: "*.js" },
    ];
    expect(extractBasePaths(patterns)).toEqual(["src"]);
  });

  it("includes root ('') alongside non-root paths for mixed patterns", () => {
    const patterns: PathPattern[] = [
      { path: ".", pattern: "CLAUDE.md" },
      { path: "src", pattern: "**/*.ts" },
    ];
    expect(extractBasePaths(patterns)).toEqual(["", "src"]);
  });
});

describe("applyPathPatterns", () => {
  it("matches a root-level file when the base path is root", () => {
    const files = [file("CLAUDE.md"), file("src/index.ts"), file("README.md")];
    for (const path of [".", "./", ""]) {
      const result = applyPathPatterns(files, [{ path, pattern: "CLAUDE.md" }]);
      expect(result.map((f) => f.path)).toEqual(["CLAUDE.md"]);
    }
  });

  it("does not prefix a root glob with './'", () => {
    // A "./CLAUDE.md" glob would fail to match the bare "CLAUDE.md" path.
    const files = [file("CLAUDE.md")];
    const result = applyPathPatterns(files, [
      { path: ".", pattern: "CLAUDE.md" },
    ]);
    expect(result.map((f) => f.path)).toEqual(["CLAUDE.md"]);
  });

  it("scopes a glob under a non-root base path", () => {
    const files = [
      file("src/a.ts"),
      file("src/nested/b.ts"),
      file("other/c.ts"),
    ];
    const result = applyPathPatterns(files, [
      { path: "src", pattern: "**/*.ts" },
    ]);
    expect(result.map((f) => f.path)).toEqual(["src/a.ts", "src/nested/b.ts"]);
  });

  it("matches mixed root + scoped patterns together", () => {
    const files = [
      file("CLAUDE.md"),
      file("README.md"),
      file("src/index.ts"),
      file("src/util.ts"),
      file("docs/guide.md"),
    ];
    const result = applyPathPatterns(files, [
      { path: ".", pattern: "CLAUDE.md" },
      { path: "src", pattern: "**/*.ts" },
    ]);
    expect(result.map((f) => f.path).sort()).toEqual([
      "CLAUDE.md",
      "src/index.ts",
      "src/util.ts",
    ]);
  });

  it("returns all files unchanged when there are no patterns", () => {
    const files = [file("a.ts"), file("b.ts")];
    expect(applyPathPatterns(files, [])).toBe(files);
  });
});
