import { describe, expect, it } from "vitest";
import {
  BARREL_PENALTY, BARREL_THRESHOLD, bfsRank, buildImportGraph, detectLanguage, extractImportSpecifiers, isBarrelFile, resolveSpecifier
} from "./import-analyzer";

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe("detectLanguage", () => {
  it("returns 'ts' for .ts files", () => {
    expect(detectLanguage("src/auth/login.ts")).toBe("ts");
  });

  it("returns 'ts' for .tsx files", () => {
    expect(detectLanguage("components/Button.tsx")).toBe("ts");
  });

  it("returns 'js' for .js files", () => {
    expect(detectLanguage("utils/helper.js")).toBe("js");
  });

  it("returns 'js' for .jsx files", () => {
    expect(detectLanguage("components/App.jsx")).toBe("js");
  });

  it("returns 'js' for .mjs files", () => {
    expect(detectLanguage("scripts/build.mjs")).toBe("js");
  });

  it("returns 'js' for .cjs files", () => {
    expect(detectLanguage("scripts/config.cjs")).toBe("js");
  });

  it("returns 'python' for .py files", () => {
    expect(detectLanguage("src/main.py")).toBe("python");
  });

  it("returns 'java' for .java files", () => {
    expect(detectLanguage("src/Main.java")).toBe("java");
  });

  it("returns 'unknown' for unrecognized extensions", () => {
    expect(detectLanguage("README.md")).toBe("unknown");
    expect(detectLanguage("config.yaml")).toBe("unknown");
    expect(detectLanguage("no-extension")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// extractImportSpecifiers
// ---------------------------------------------------------------------------
describe("extractImportSpecifiers", () => {
  describe("TypeScript / JavaScript", () => {
    it("extracts named import", () => {
      const result = extractImportSpecifiers('import { foo } from "./bar"', "ts");
      expect(result).toContain("./bar");
    });

    it("extracts type import", () => {
      const result = extractImportSpecifiers('import type { Foo } from "../types"', "ts");
      expect(result).toContain("../types");
    });

    it("extracts re-export with braces", () => {
      const result = extractImportSpecifiers('export { X } from "./x"', "ts");
      expect(result).toContain("./x");
    });

    it("extracts wildcard re-export", () => {
      const result = extractImportSpecifiers('export * from "./utils"', "ts");
      expect(result).toContain("./utils");
    });

    it("extracts require()", () => {
      const result = extractImportSpecifiers('const x = require("./module")', "ts");
      expect(result).toContain("./module");
    });

    it("extracts side-effect imports", () => {
      const result = extractImportSpecifiers('import "side-effect"', "ts");
      expect(result).toContain("side-effect");
    });

    it("extracts external package imports (not filtered)", () => {
      const result = extractImportSpecifiers('import react from "react"', "ts");
      expect(result).toContain("react");
    });

    it("extracts multiple imports from the same content", () => {
      const content = `
import { foo } from "./foo";
import { bar } from "./bar";
export * from "./baz";
`;
      const result = extractImportSpecifiers(content, "ts");
      expect(result).toContain("./foo");
      expect(result).toContain("./bar");
      expect(result).toContain("./baz");
    });

    it("works with 'js' language", () => {
      const result = extractImportSpecifiers('import { x } from "./y"', "js");
      expect(result).toContain("./y");
    });

    it("returns empty array for content with no imports", () => {
      const result = extractImportSpecifiers("const x = 1;\nconst y = 2;", "ts");
      expect(result).toEqual([]);
    });
  });

  describe("Python", () => {
    it("extracts 'from x import y'", () => {
      const result = extractImportSpecifiers("from os.path import join", "python");
      expect(result).toContain("os.path");
    });

    it("extracts 'import x'", () => {
      const result = extractImportSpecifiers("import sys", "python");
      expect(result).toContain("sys");
    });

    it("extracts relative python imports", () => {
      const result = extractImportSpecifiers("from .utils import helper", "python");
      expect(result).toContain(".utils");
    });
  });

  describe("Java", () => {
    it("extracts java import statements", () => {
      const result = extractImportSpecifiers("import com.example.Foo;", "java");
      expect(result).toContain("com.example.Foo");
    });

    it("extracts multiple java imports", () => {
      const content = "import java.util.List;\nimport java.util.Map;";
      const result = extractImportSpecifiers(content, "java");
      expect(result).toContain("java.util.List");
      expect(result).toContain("java.util.Map");
    });
  });

  describe("unknown language", () => {
    it("returns empty array for unknown language", () => {
      const result = extractImportSpecifiers("import stuff from 'place'", "unknown");
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveSpecifier
// ---------------------------------------------------------------------------
describe("resolveSpecifier", () => {
  it("returns null for external (non-relative) specifiers", () => {
    expect(resolveSpecifier("react", "src/a.ts", new Set(["react"]))).toBeNull();
    expect(resolveSpecifier("lodash", "src/a.ts", new Set(["lodash"]))).toBeNull();
  });

  it("resolves by extension elision (adds .ts)", () => {
    expect(resolveSpecifier("./bar", "src/login.ts", new Set(["src/bar.ts"]))).toBe("src/bar.ts");
  });

  it("resolves by extension elision (adds .tsx)", () => {
    expect(resolveSpecifier("./Button", "src/components/index.ts", new Set(["src/components/Button.tsx"]))).toBe(
      "src/components/Button.tsx"
    );
  });

  it("resolves by extension elision (adds .js)", () => {
    expect(resolveSpecifier("./helper", "src/a.ts", new Set(["src/helper.js"]))).toBe("src/helper.js");
  });

  it("resolves index file", () => {
    expect(resolveSpecifier("./utils", "src/a.ts", new Set(["src/utils/index.ts"]))).toBe("src/utils/index.ts");
  });

  it("resolves index.tsx", () => {
    expect(
      resolveSpecifier("./components", "src/page.ts", new Set(["src/components/index.tsx"]))
    ).toBe("src/components/index.tsx");
  });

  it("resolves exact match first", () => {
    const available = new Set(["src/bar.ts", "src/bar.tsx"]);
    // If exact match is "src/bar" — not in set; extension elision finds .ts first
    expect(resolveSpecifier("./bar", "src/login.ts", available)).toBe("src/bar.ts");
  });

  it("resolves parent directory traversal", () => {
    expect(resolveSpecifier("../shared", "src/auth/login.ts", new Set(["src/shared.ts"]))).toBe("src/shared.ts");
  });

  it("returns null when specifier not found in available paths", () => {
    expect(resolveSpecifier("./missing", "src/a.ts", new Set())).toBeNull();
  });

  it("returns null when specifier with extensions not in available paths", () => {
    expect(resolveSpecifier("./nofile", "src/a.ts", new Set(["src/other.ts"]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isBarrelFile
// ---------------------------------------------------------------------------
describe("isBarrelFile", () => {
  it("returns false for empty content", () => {
    expect(isBarrelFile("")).toBe(false);
  });

  it("returns false for only blank lines", () => {
    expect(isBarrelFile("   \n\n  \n")).toBe(false);
  });

  it("returns true when 100% of non-blank lines are re-exports", () => {
    const content = `export { A } from "./a"
export { B } from "./b"
export { C } from "./c"`;
    expect(isBarrelFile(content)).toBe(true);
  });

  it("returns true when re-export lines >= BARREL_THRESHOLD", () => {
    // 3 re-exports out of 4 non-blank lines = 75% >= 70%
    const content = `export { A } from "./a"
export { B } from "./b"
export { C } from "./c"
const version = "1.0";`;
    const ratio = 3 / 4;
    expect(ratio).toBeGreaterThanOrEqual(BARREL_THRESHOLD);
    expect(isBarrelFile(content)).toBe(true);
  });

  it("returns false when re-export lines < BARREL_THRESHOLD", () => {
    // 1 re-export out of 2 non-blank lines = 50% < 70%
    const content = `export { A } from "./a"
const x = 1;`;
    expect(isBarrelFile(content)).toBe(false);
  });

  it("detects 'export *' as re-export lines", () => {
    const content = `export * from "./utils"
export * from "./helpers"`;
    expect(isBarrelFile(content)).toBe(true);
  });

  it("does not count regular export statements as re-exports", () => {
    // "export const x = 1" is not a re-export
    const content = `export const x = 1;
export function foo() {}
export class Bar {}`;
    expect(isBarrelFile(content)).toBe(false);
  });

  it("BARREL_THRESHOLD is 0.7", () => {
    expect(BARREL_THRESHOLD).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// buildImportGraph
// ---------------------------------------------------------------------------
describe("buildImportGraph", () => {
  it("builds adjacency graph from file contents", () => {
    const fileContents = new Map([
      ["src/a.ts", 'import { b } from "./b"'],
      ["src/b.ts", 'import { c } from "./c"'],
      ["src/c.ts", "export const c = 1;"],
    ]);
    const availablePaths = new Set(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const graph = buildImportGraph(fileContents, availablePaths);

    expect(graph.get("src/a.ts")).toEqual(new Set(["src/b.ts"]));
    expect(graph.get("src/b.ts")).toEqual(new Set(["src/c.ts"]));
    expect(graph.get("src/c.ts")).toEqual(new Set());
  });

  it("gives empty Set to paths in availablePaths but not in fileContents", () => {
    const fileContents = new Map([["src/a.ts", 'import { b } from "./b"']]);
    const availablePaths = new Set(["src/a.ts", "src/b.ts"]);
    const graph = buildImportGraph(fileContents, availablePaths);

    // b.ts appears in availablePaths but has no content — should get empty Set
    expect(graph.get("src/b.ts")).toEqual(new Set());
  });

  it("ignores external specifiers (not in availablePaths)", () => {
    const fileContents = new Map([["src/a.ts", 'import react from "react"']]);
    const availablePaths = new Set(["src/a.ts"]);
    const graph = buildImportGraph(fileContents, availablePaths);

    expect(graph.get("src/a.ts")).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// bfsRank
// ---------------------------------------------------------------------------
describe("bfsRank", () => {
  it("ranks files by BFS distance from seed", () => {
    const graph = new Map<string, Set<string>>([
      ["A", new Set(["B", "C"])],
      ["B", new Set(["D"])],
      ["C", new Set()],
      ["D", new Set()],
    ]);
    const allPaths = ["A", "B", "C", "D"];
    const result = bfsRank("A", graph, allPaths, new Set<string>());

    // A = distance 0, B and C = distance 1, D = distance 2
    const byPath = Object.fromEntries(result.map((r) => [r.path, r.effectiveDistance]));
    expect(byPath["A"]).toBe(0);
    expect(byPath["B"]).toBe(1);
    expect(byPath["C"]).toBe(1);
    expect(byPath["D"]).toBe(2);

    // Verify sorted ascending
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].effectiveDistance).toBeLessThanOrEqual(result[i + 1].effectiveDistance);
    }
  });

  it("handles circular imports without infinite loop", () => {
    const graph = new Map<string, Set<string>>([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])], // circular
    ]);
    const allPaths = ["A", "B"];
    // Should terminate
    const result = bfsRank("A", graph, allPaths, new Set<string>());
    expect(result).toHaveLength(2);

    const byPath = Object.fromEntries(result.map((r) => [r.path, r.effectiveDistance]));
    expect(byPath["A"]).toBe(0);
    expect(byPath["B"]).toBe(1);
  });

  it("applies barrel penalty to barrel files", () => {
    const graph = new Map<string, Set<string>>([
      ["A", new Set(["index"])],
      ["index", new Set()],
    ]);
    const allPaths = ["A", "index", "X"];
    const barrelPaths = new Set(["index"]);
    const result = bfsRank("A", graph, allPaths, barrelPaths);

    const byPath = Object.fromEntries(
      result.map((r) => [r.path, r.effectiveDistance])
    );
    // index: BFS distance = 1, penalty = BARREL_PENALTY (3), effectiveDistance = 4
    expect(byPath["index"]).toBe(1 + BARREL_PENALTY);
    // X: unreachable, effectiveDistance = Infinity
    expect(byPath["X"]).toBe(Infinity);
  });

  it("appends unreachable files at the end with Infinity distance", () => {
    const graph = new Map<string, Set<string>>([
      ["A", new Set()],
    ]);
    const allPaths = ["A", "B", "C"];
    const result = bfsRank("A", graph, allPaths, new Set<string>());

    const reachable = result.filter((r) => r.effectiveDistance !== Infinity);
    const unreachable = result.filter((r) => r.effectiveDistance === Infinity);

    expect(reachable.map((r) => r.path)).toContain("A");
    expect(unreachable.map((r) => r.path)).toContain("B");
    expect(unreachable.map((r) => r.path)).toContain("C");

    // Reachable always comes before unreachable
    const lastReachableIndex = result.findLastIndex((r) => r.effectiveDistance !== Infinity);
    const firstUnreachableIndex = result.findIndex((r) => r.effectiveDistance === Infinity);
    if (lastReachableIndex !== -1 && firstUnreachableIndex !== -1) {
      expect(lastReachableIndex).toBeLessThan(firstUnreachableIndex);
    }
  });

  it("includes the seed itself at distance 0", () => {
    const graph = new Map<string, Set<string>>([["A", new Set(["B"])]]);
    const allPaths = ["A", "B"];
    const result = bfsRank("A", graph, allPaths, new Set<string>());

    expect(result[0].path).toBe("A");
    expect(result[0].effectiveDistance).toBe(0);
  });

  it("BARREL_PENALTY is 3", () => {
    expect(BARREL_PENALTY).toBe(3);
  });
});
