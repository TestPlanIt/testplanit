import micromatch from "micromatch";
import { describe, expect, it } from "vitest";

import { countGlobMatches } from "./globMatch";

const PATHS = [
  "src/a.ts",
  "src/b.tsx",
  "src/deep/c.ts",
  "src/deep/er/d.test.ts",
  "README.md",
  ".env",
  ".github/workflows/ci.yml",
  "src/.hidden/x.ts",
  "file1.txt",
  "file2.txt",
  "file3.txt",
  "file10.txt",
  "a/b/c/d.js",
  "lib/x.JS",
  "docs/My File.md",
  "src/[locale]/page.tsx",
  "src/(group)/x.ts",
  "a.b/c.d",
  "foo",
];

const PATTERNS = [
  "src/*.ts",
  "src/**",
  "src/**/*.ts",
  "**/*.ts",
  "*.md",
  "**",
  "*",
  "src/{a,b}.{ts,tsx}",
  "file{1..3}.txt",
  "file{01..10}.txt",
  "!src/**",
  "!**/*.ts",
  "src/**/!(*.test).ts",
  "**/.*",
  "**/.*/**",
  "**/*.{js,JS}",
  "docs/My File.md",
  "src/[locale]/page.tsx",
  "src/\\[locale\\]/page.tsx",
  "src/(group)/x.ts",
  "src/?.ts",
  "file[0-9].txt",
  "./src/a.ts",
  "SRC/a.ts",
  "+(src|lib)/**",
  "{src,lib}/**",
  "file{1..3",
];

describe("countGlobMatches", () => {
  it.each(PATTERNS)(
    "counts what the server's matcher matches for %s",
    (pattern) => {
      expect(countGlobMatches(PATHS, pattern)).toBe(
        micromatch(PATHS, pattern, { dot: true }).length
      );
    }
  );

  it("matches dotfiles, as the server does", () => {
    expect(countGlobMatches([".env", "src/.hidden/x.ts"], "**")).toBe(2);
  });

  it("matches nothing in an empty list", () => {
    expect(countGlobMatches([], "**")).toBe(0);
  });
});
