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
      { path: "", pattern: "**/*" },
      { path: ".", pattern: "*.md" },
    ]);
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
