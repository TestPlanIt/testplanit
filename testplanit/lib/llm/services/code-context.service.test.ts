import { describe, it, expect, vi } from "vitest";

// Mock prisma to avoid ZenStack enhance() call at module load time
vi.mock("@/lib/prisma", () => ({
  prisma: {},
  db: {},
}));

import {
  extractTerms,
  scoreFileRelevance,
  applyPathPatterns,
  CodeContextService,
} from "./code-context.service";
import type { RepoFileEntry } from "~/lib/integrations/cache/RepoFileCache";

describe("extractTerms", () => {
  it("extracts meaningful words from text", () => {
    const terms = extractTerms("User Login with Valid Credentials");
    expect(terms.has("user")).toBe(false); // stop word
    expect(terms.has("login")).toBe(true);
    expect(terms.has("valid")).toBe(true);
    expect(terms.has("credentials")).toBe(true);
  });

  it("removes stop words", () => {
    const terms = extractTerms("the user can click and verify");
    expect(terms.has("the")).toBe(false);
    expect(terms.has("user")).toBe(false);
    expect(terms.has("click")).toBe(false);
    expect(terms.has("verify")).toBe(false);
  });

  it("removes short tokens (3 chars or fewer)", () => {
    const terms = extractTerms("go to the app");
    expect(terms.size).toBe(0);
  });

  it("lowercases all terms", () => {
    const terms = extractTerms("Authentication Password Reset");
    expect(terms.has("authentication")).toBe(true);
    expect(terms.has("password")).toBe(true);
    expect(terms.has("reset")).toBe(true);
  });

  it("splits on non-alphanumeric characters", () => {
    const terms = extractTerms("login-page.spec.ts");
    expect(terms.has("login")).toBe(true);
    expect(terms.has("page")).toBe(false); // stop word
    expect(terms.has("spec")).toBe(true);
  });

  it("returns empty set for empty string", () => {
    expect(extractTerms("").size).toBe(0);
  });

  it("deduplicates terms", () => {
    const terms = extractTerms("login login login");
    expect(terms.size).toBe(1);
    expect(terms.has("login")).toBe(true);
  });
});

describe("scoreFileRelevance", () => {
  it("returns 0 for empty terms", () => {
    expect(scoreFileRelevance("src/auth/login.ts", new Set())).toBe(0);
  });

  it("scores based on matching path segments", () => {
    const terms = new Set(["login", "auth"]);
    expect(scoreFileRelevance("src/auth/login.ts", terms)).toBe(2);
  });

  it("returns 0 when no segments match", () => {
    const terms = new Set(["payment", "checkout"]);
    expect(scoreFileRelevance("src/auth/login.ts", terms)).toBe(0);
  });

  it("splits path on slashes, dots, hyphens, and underscores", () => {
    const terms = new Set(["login", "page"]);
    expect(scoreFileRelevance("tests/e2e/login-page.spec.ts", terms)).toBe(2);
  });

  it("ignores short segments (2 chars or fewer)", () => {
    const terms = new Set(["ts", "js"]);
    expect(scoreFileRelevance("src/a.ts", terms)).toBe(0);
  });

  it("is case-insensitive", () => {
    const terms = new Set(["login"]);
    expect(scoreFileRelevance("src/Login.ts", terms)).toBe(1);
  });
});

describe("applyPathPatterns", () => {
  const files: RepoFileEntry[] = [
    { path: "src/auth/login.ts", size: 100, type: "file" },
    { path: "src/auth/signup.ts", size: 200, type: "file" },
    { path: "src/utils/helper.ts", size: 50, type: "file" },
    { path: "tests/auth.test.ts", size: 150, type: "file" },
    { path: "README.md", size: 300, type: "file" },
  ];

  it("returns all files when no patterns provided", () => {
    expect(applyPathPatterns(files, [])).toEqual(files);
  });

  it("filters files matching a single pattern", () => {
    const result = applyPathPatterns(files, [
      { path: "src/auth", pattern: "**/*.ts" },
    ]);
    expect(result.map((f) => f.path)).toEqual([
      "src/auth/login.ts",
      "src/auth/signup.ts",
    ]);
  });

  it("combines multiple patterns (union)", () => {
    const result = applyPathPatterns(files, [
      { path: "src/auth", pattern: "**/*.ts" },
      { path: "tests", pattern: "**/*.ts" },
    ]);
    expect(result.map((f) => f.path)).toEqual([
      "src/auth/login.ts",
      "src/auth/signup.ts",
      "tests/auth.test.ts",
    ]);
  });

  it("handles patterns with trailing slash on path", () => {
    const result = applyPathPatterns(files, [
      { path: "src/auth/", pattern: "**/*.ts" },
    ]);
    expect(result.map((f) => f.path)).toEqual([
      "src/auth/login.ts",
      "src/auth/signup.ts",
    ]);
  });

  it("handles root-level pattern with empty path", () => {
    const result = applyPathPatterns(files, [
      { path: "", pattern: "**/*.md" },
    ]);
    expect(result.map((f) => f.path)).toEqual(["README.md"]);
  });
});

describe("CodeContextService.estimateTokens", () => {
  it("estimates tokens at ~4 chars per token", () => {
    expect(CodeContextService.estimateTokens("abcd")).toBe(1);
    expect(CodeContextService.estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up for partial tokens", () => {
    expect(CodeContextService.estimateTokens("abcde")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(CodeContextService.estimateTokens("")).toBe(0);
  });

  it("handles large text", () => {
    const text = "a".repeat(4000);
    expect(CodeContextService.estimateTokens(text)).toBe(1000);
  });
});
