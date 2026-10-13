import { describe, expect, it } from "vitest";
import { pathPatternsSchema } from "./PathPatternsCard";

const tRepo = (key: string) => key;

describe("pathPatternsSchema", () => {
  it("accepts a blank path as the repository root and trims both fields", () => {
    const parsed = pathPatternsSchema(tRepo).safeParse([
      { path: "  ", pattern: " **/* " },
      { path: " . ", pattern: "*.md" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([
      { path: "", pattern: "**/*", exclude: false },
      { path: ".", pattern: "*.md", exclude: false },
    ]);
  });

  it("keeps an exclude row and requires at least one include row", () => {
    const parsed = pathPatternsSchema(tRepo).safeParse([
      { path: "src", pattern: "**/*" },
      { path: "", pattern: "**/CHANGELOG*", exclude: true },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.[1]).toEqual({
      path: "",
      pattern: "**/CHANGELOG*",
      exclude: true,
    });

    const onlyExcludes = pathPatternsSchema(tRepo).safeParse([
      { path: "", pattern: "**/CHANGELOG*", exclude: true },
    ]);
    expect(onlyExcludes.success).toBe(false);
    expect(onlyExcludes.error?.issues[0]?.message).toBe(
      "validation.pathPatternRequired"
    );
  });

  it("requires a pattern on every row", () => {
    const parsed = pathPatternsSchema(tRepo).safeParse([
      { path: "src", pattern: "  " },
    ]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: [0, "pattern"],
      message: "validation.patternRequired",
    });
  });

  it("requires at least one row", () => {
    const parsed = pathPatternsSchema(tRepo).safeParse([]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "validation.pathPatternRequired"
    );
  });
});
