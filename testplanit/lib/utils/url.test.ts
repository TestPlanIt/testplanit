import { describe, expect, it } from "vitest";
import { stripTrailingSlashes } from "./url";

describe("stripTrailingSlashes", () => {
  it("removes every trailing slash", () => {
    expect(stripTrailingSlashes("https://proxy.example.com/v1///")).toBe(
      "https://proxy.example.com/v1"
    );
  });

  it("leaves strings without a trailing slash untouched", () => {
    expect(stripTrailingSlashes("https://proxy.example.com/v1")).toBe(
      "https://proxy.example.com/v1"
    );
    expect(stripTrailingSlashes("")).toBe("");
  });

  it("keeps interior slashes", () => {
    expect(stripTrailingSlashes("a//b/")).toBe("a//b");
  });

  it("empties a string made only of slashes", () => {
    expect(stripTrailingSlashes("////")).toBe("");
  });

  it("handles a long run of interior slashes in linear time", () => {
    const input = `${"/".repeat(200_000)}x`;
    expect(stripTrailingSlashes(input)).toBe(input);
  });
});
